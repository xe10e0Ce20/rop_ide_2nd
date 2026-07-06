import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { ROP_LANG_ID, languageDef, configDef } from './ropLanguage';
import { createRopCompletionProvider, createRopHoverProvider, createRopDefinitionProvider } from './ropCompletion';
import type { WebCompileResult, AutocompleteMeta } from './types';
import RopLibraryModal from './components/RopLibraryModal';
import { getAllVFSLibs, saveVFSLib, deleteVFSLib } from './utils/vfs';
import type { ManagedLib, LibVersion } from './utils/vfs';

import initWasm, { compile_for_web, get_autocomplete_metadata } from './wasm_pkg/rop_compiler';
import pkg from '../package.json';

const LOCAL_STORAGE_KEY = 'rop_ide_source_code_cache';

interface LibItem {
  name: string;
  author: string;
  description: string;
  code: string;
  updatedAt: number;
}

// 将 Map 或类 Map 对象转换为普通对象
function toRecord(mapLike: any): Record<string, any> {
  if (!mapLike) return {};
  if (typeof mapLike.forEach === 'function') {
    const obj: Record<string, any> = {};
    mapLike.forEach((value: any, key: string) => { obj[key] = value; });
    return obj;
  }
  return mapLike as Record<string, any>;
}

export default function App() {
  const [wasmReady, setWasmReady] = useState<boolean>(false);
  const [editorWidth, setEditorWidth] = useState<number>(58);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [vfsLibs, setVfsLibs] = useState<ManagedLib[]>([]);
  const vfsLibsRef = useRef<ManagedLib[]>([]);

  const [activeViewLib, setActiveViewLib] = useState<ManagedLib | null>(null);
  const [activeBlockByCursor, setActiveBlockByCursor] = useState<string | null>(null);
  const [highlightRanges, setHighlightRanges] = useState<{ start: number; end: number }[]>([]);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const compileOutputRef = useRef<WebCompileResult | null>(null);
  const spanMapRef = useRef<Record<string, [number, number, number, number][]>>({});
  const activeBlockRef = useRef<string | null>(null);

  useEffect(() => {
    vfsLibsRef.current = vfsLibs;
  }, [vfsLibs]);

  const [code, setCode] = useState<string>(() => {
    const cachedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    return cachedData === null || cachedData === '' ? getSampleCode() : cachedData;
  });

  const refreshVFS = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const libs = await getAllVFSLibs();
      setVfsLibs(libs);
    } catch (err) {
      console.error("读取本地 VFS 失败:", err);
    } finally {
      if (isManual) {
        setTimeout(() => setIsRefreshing(false), 300);
      }
    }
  }, []);

  useEffect(() => {
    // 使用 setTimeout 剥离出当前的同步调用栈
    const timer = setTimeout(() => {
      refreshVFS(false);
    }, 0);
    
    return () => clearTimeout(timer);
  }, [refreshVFS]);

  // 心跳轮询
  useEffect(() => {
    let isMounted = true;
    let timeoutId: any;
    const checkRealOnlineStatus = async () => {
      if (!navigator.onLine) { if (isMounted) setIsOnline(false); return; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      try {
        await fetch(`https://cloudflare.com/cdn-cgi/trace?t=${Date.now()}`, {
          method: 'GET', mode: 'cors', cache: 'no-store', signal: controller.signal
        });
        clearTimeout(timer);
        if (isMounted) setIsOnline(true);
      } catch (e) { clearTimeout(timer); if (isMounted) setIsOnline(false); }
    };
    const runPoll = async () => { await checkRealOnlineStatus(); if (isMounted) timeoutId = setTimeout(runPoll, 2500); };
    window.addEventListener('online', checkRealOnlineStatus);
    window.addEventListener('offline', () => { if (isMounted) setIsOnline(false); });
    runPoll();
    return () => { isMounted = false; clearTimeout(timeoutId); };
  }, []);

  useEffect(() => { localStorage.setItem(LOCAL_STORAGE_KEY, code); }, [code]);
  useEffect(() => { initWasm().then(() => setWasmReady(true)).catch(err => console.error("WASM 加载失败:", err)); }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = editorWidth;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = ((moveEvent.clientX - startX) / window.innerWidth) * 100;
      setEditorWidth(Math.min(Math.max(startWidth + delta, 20), 80));
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // WASM 编译器接入：处理无 @ 前缀的纯库名依赖加载
  const compileOutput = useMemo<WebCompileResult | null>(() => {
    if (!wasmReady) return null;
    try {
      return compile_for_web(code, (importString: string) => {
        // 去掉可能存在的版本后缀，统一根据锁定版本策略加载
        const [libName, requestedVersion] = importString.split('@');
        const targetLib = vfsLibs.find(l => l.name === libName);
        if (!targetLib) return "";
        const versionToFetch = requestedVersion || targetLib.activeVersion;
        return targetLib.versions[versionToFetch]?.code || "";
      }) as WebCompileResult;
    } catch (e) {
      console.error(e);
      return { success: false, error_message: "WASM 执行崩溃" + e, blocks: {} };
    }
  }, [code, wasmReady, vfsLibs]);

  const blocks = useMemo(() => {
    if (!compileOutput?.blocks) return {};
    return toRecord(compileOutput.blocks) as Record<string, string>;
  }, [compileOutput]);

  const spanMapObj = useMemo(() => {
    if (!compileOutput?.span_map) return {};
    return toRecord(compileOutput.span_map) as Record<string, [number, number, number, number][]>;
  }, [compileOutput]);

  useEffect(() => { compileOutputRef.current = compileOutput; }, [compileOutput]);
  useEffect(() => { spanMapRef.current = spanMapObj; }, [spanMapObj]);

  // 计算所有 block 的行范围
  const blockIntervals = useMemo(() => {
    const intervals: { name: string; start: number; end: number }[] = [];
    const lines = code.split('\n');
    const blockStartRegex = /\bblock\s+([a-zA-Z_]\w*)\s*\{/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(blockStartRegex);
      if (match) {
        const name = match[1];
        let braceCount = 0;
        let endLine = lines.length;
        for (let j = i; j < lines.length; j++) {
          const line = lines[j];
          const openBraces = (line.match(/\{/g) || []).length;
          const closeBraces = (line.match(/\}/g) || []).length;
          if (j === i) {
            braceCount = openBraces;
          } else {
            braceCount += openBraces - closeBraces;
          }
          if (braceCount === 0) {
            endLine = j + 1; // 行号从1开始
            break;
          }
        }
        intervals.push({ name, start: i + 1, end: endLine });
      }
    }
    return intervals;
  }, [code]);

  const activeBlockName = useMemo(() => {
    if (activeBlockByCursor) return activeBlockByCursor;
    const names = Object.keys(blocks);
    return names.length > 0 ? names[0] : null;
  }, [activeBlockByCursor, blocks]);

  useEffect(() => { activeBlockRef.current = activeBlockName; }, [activeBlockName]);

  useEffect(() => {
    (window as any).__debug = { compileOutput, blocks, spanMapObj, activeBlockName, highlightRanges, blockIntervals };
  }, [compileOutput, blocks, spanMapObj, activeBlockName, highlightRanges, blockIntervals]);

  // 光标追踪，多范围高亮
  const handleCursorChange = useCallback((editor: any) => {
    const position = editor.getPosition();
    if (!position) return;
    const model = editor.getModel();
    if (!model) return;
    const offset = model.getOffsetAt(position);
    const line = position.lineNumber;

    const currentBlock = blockIntervals.find(interval => line >= interval.start && line <= interval.end)?.name || null;
    setActiveBlockByCursor(currentBlock);

    const block = currentBlock;
    const map = spanMapRef.current;
    if (!block || !map[block]) {
      setHighlightRanges([]);
      return;
    }

    const mappings = map[block];
    const matched: { start: number; end: number }[] = [];
    for (const [srcStart, srcEnd, outStart, outEnd] of mappings) {
      if (offset >= srcStart && offset < srcEnd) {
        matched.push({ start: outStart, end: outEnd });
      }
    }

    let best: { start: number; end: number } | null = null;
    for (const m of matched) {
      if (!best || (m.end - m.start) < (best.end - best.start)) {
        best = m;
      }
    }
    setHighlightRanges(best ? [best] : []);
  }, [blockIntervals]);

  // 错误波浪线
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (!compileOutput || compileOutput.success) {
      monaco.editor.setModelMarkers(model, "rop_compiler", []);
      return;
    }

    if (compileOutput.line != null && compileOutput.column != null) {
      const errLine = compileOutput.line;
      const errCol = compileOutput.column ?? 1;
      const lineContent = model.getLineContent(errLine) || "";
      const endCol = Math.max(errCol + 1, lineContent.length + 1);
      monaco.editor.setModelMarkers(model, "rop_compiler", [
        {
          startLineNumber: errLine,
          startColumn: errCol,
          endLineNumber: errLine,
          endColumn: endCol,
          message: compileOutput.error_message || "编译语义错误",
          severity: monaco.MarkerSeverity.Error,
        },
      ]);
    } else {
      monaco.editor.setModelMarkers(model, "rop_compiler", []);
    }
  }, [compileOutput]);

  const handleEditorWillMount = (monaco: Monaco) => {
    monaco.languages.register({ id: ROP_LANG_ID });
    monaco.languages.setMonarchTokensProvider(ROP_LANG_ID, languageDef as any);
    monaco.languages.setLanguageConfiguration(ROP_LANG_ID, configDef as any);

    monaco.editor.defineTheme('ropTheme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'rop.keyword', foreground: '#C586C0', fontStyle: 'bold' },
        { token: 'rop.directive', foreground: '#CE9178' },
        { token: 'rop.label.definition', foreground: '#D9662C', fontStyle: 'bold' },
        { token: 'rop.label.reference', foreground: '#4FC1FF' },
        { token: 'rop.label.rawrefrence', foreground: '#8BE9FD' },
        { token: 'rop.macro.call', foreground: '#DCDCAA' },
        { token: 'rop.bytecode', foreground: '#B5CEA8' },
        { token: 'rop.hex', foreground: '#0CD4AF' },
        { token: 'rop.comment', foreground: '#6A9955', fontStyle: 'italic' }
      ],
      colors: {
        'editor.background': '#151515',
        'editor.foreground': '#D4D4D4'
      }
    });
    monaco.editor.setTheme('ropTheme');

    // 获取增强源码（匹配标准 `@import(std_io)` 去掉 @ 前缀库查找逻辑）
    const getAugmentedSourceForMetadata = (src: string): string => {
      const lines = src.split('\n');
      const importPattern = /^@import\s*\(\s*([a-zA-Z_]\w*)(?:@([\w.]+))?\s*\)\s*$/;
      let augmented = src;
      for (const line of lines) {
        const match = line.trim().match(importPattern);
        if (match) {
          const libName = match[1];
          const versionTag = match[2];
          const lib = vfsLibsRef.current.find(l => l.name === libName);
          if (lib) {
            const codeText = lib.versions[versionTag || lib.activeVersion]?.code || '';
            augmented += '\n' + codeText;
          }
        }
      }
      return augmented;
    };

    const getAutocompleteMetaWithLibs = (src: string): AutocompleteMeta => {
      const augmentedSource = getAugmentedSourceForMetadata(src);
      return get_autocomplete_metadata(augmentedSource) as AutocompleteMeta;
    };

    // 自动补全
    monaco.languages.registerCompletionItemProvider(
      ROP_LANG_ID,
      createRopCompletionProvider(getAutocompleteMetaWithLibs)
    );

    // 辅助函数：获取 def 区间
    function getDefIntervals(codeText: string): Array<{ start: number; end: number }> {
      const lines = codeText.split('\n');
      const intervals: Array<{ start: number; end: number }> = [];
      const defStartRegex = /\bdef\s+[a-zA-Z_]\w*\b/;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (defStartRegex.test(line)) {
          let braceLine = i;
          let foundBrace = false;
          while (braceLine < lines.length) {
            if (lines[braceLine].includes('{')) {
              foundBrace = true;
              break;
            }
            braceLine++;
          }
          if (!foundBrace) continue;

          let braceCount = 0;
          let endLine = -1;
          for (let j = braceLine; j < lines.length; j++) {
            const sub = lines[j];
            const open = (sub.match(/\{/g) || []).length;
            const close = (sub.match(/\}/g) || []).length;
            if (j === braceLine) braceCount = open;
            else braceCount += open - close;
            if (braceCount <= 0) {
              endLine = j + 1; // 行号从1开始
              break;
            }
          }
          if (endLine !== -1) {
            intervals.push({ start: i + 1, end: endLine });
            i = endLine - 1;
          }
        }
      }
      return intervals;
    }

    // 标签定义查找
    const getLabelDefinition = (word: string, codeText: string, currentLine: number) => {
      const lines = codeText.split('\n');
      const defIntervals = getDefIntervals(codeText);
      const activeDef = defIntervals.find(interval => currentLine >= interval.start && currentLine <= interval.end);
      const startLine = activeDef ? activeDef.start : 1;
      const endLine = activeDef ? activeDef.end : lines.length;

      const labelDefRegex = new RegExp(`^\\s*(${word})\\s*:`);
      for (let i = startLine; i <= endLine; i++) {
        const line = lines[i - 1] || '';
        if (labelDefRegex.test(line)) {
          const commentLines: string[] = [];
          let p = i - 1;
          while (p >= startLine) {
            const trimmed = (lines[p - 1] || '').trim();
            if (trimmed.startsWith('//')) {
              commentLines.unshift(trimmed.replace(/^\/\/+/, '').trim());
              p--;
            } else if (trimmed === '') {
              p--;
            } else {
              break;
            }
          }
          return { line: i, comment: commentLines.join('\n') };
        }
      }
      return null;
    };

    // 悬停提示
    const nativeHoverProvider = createRopHoverProvider(
      getAutocompleteMetaWithLibs,
      (libName: string) => {
        const lib = vfsLibsRef.current.find((l: ManagedLib) => l.name === libName);
        return lib ? (lib.versions[lib.activeVersion]?.code || "") : "";
      }
    );
    monaco.languages.registerHoverProvider(ROP_LANG_ID, {
      provideHover: async (model: any, position: any) => {
        const wordInfo = model.getWordAtPosition(position);
        if (!wordInfo) return null;

        const nativeResult = await Promise.resolve(nativeHoverProvider.provideHover(model, position));
        if (nativeResult) return nativeResult;

        const labelInfo = getLabelDefinition(wordInfo.word, model.getValue(), position.lineNumber);
        if (labelInfo) {
          return {
            contents: [
              { value: labelInfo.comment ? labelInfo.comment : `*地址标签 \`${wordInfo.word}\` 定位于第 ${labelInfo.line} 行*` }
            ]
          };
        }
        return null;
      }
    });

    // 定义跳转
    const nativeDefinitionProvider = createRopDefinitionProvider();
    monaco.languages.registerDefinitionProvider(ROP_LANG_ID, {
      provideDefinition: async (model: any, position: any) => {
        const wordInfo = model.getWordAtPosition(position);
        if (!wordInfo) return null;

        const nativeDef = await Promise.resolve(nativeDefinitionProvider.provideDefinition(model, position));
        if (nativeDef) return nativeDef;

        const labelInfo = getLabelDefinition(wordInfo.word, model.getValue(), position.lineNumber);
        if (labelInfo) {
          return {
            uri: model.uri,
            range: {
              startLineNumber: labelInfo.line,
              startColumn: 1,
              endLineNumber: labelInfo.line,
              endColumn: 1
            }
          };
        }
        return null;
      }
    });
  };

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorPosition(() => handleCursorChange(editor));
    (window as any).__debug_editor = editor;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#121212', color: '#e0e0e0', position: 'fixed', top: 0, left: 0 }}>
      {/* 顶部状态栏 */}
      <div style={{ padding: '12px 24px', background: '#1a1a1a', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#00ffb3' }}>ROP IDE 2nd</h2>
          <span style={{ fontSize: '12px', color: '#666', fontFamily: "'JetBrains Mono', monospace", fontWeight: 'bold', marginRight: '5px' }}>v{pkg.version}</span>
          
          <button 
            type="button"
            onClick={() => setIsModalOpen(true)}
            style={{ background: '#222', border: '1px solid #333', color: '#00ffb3', padding: '4px 12px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#2a2a2a'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#222'}
          >
            📦 Global Library
          </button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#111', padding: '4px 12px', borderRadius: '20px', border: '1px solid #222' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? '#00ffb3' : '#ff5555', boxShadow: isOnline ? '0 0 8px #00ffb3' : '0 0 8px #ff5555' }} />
          <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: isOnline ? '#aaa' : '#ff8888' }}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* 主工作区 */}
      <div style={{ display: 'flex', flex: 1, width: '100%', overflow: 'hidden' }}>
        <div style={{ width: `${editorWidth}%`, height: '100%' }}>
          <Editor
            height="100%" 
            theme="ropTheme" 
            language={ROP_LANG_ID} 
            value={code}
            onChange={(val) => setCode(val ?? '')}
            beforeMount={handleEditorWillMount}
            onMount={handleEditorDidMount}
            options={{ 
              fontSize: 14, minimap: { enabled: false }, fontFamily: "'JetBrains Mono', monospace",
              automaticLayout: true, lineNumbersMinChars: 4
            }}
          />
        </div>

        <div onMouseDown={handleMouseDown} style={{ width: '6px', background: '#222', cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
          <div style={{ width: '2px', height: '30px', background: '#444' }} />
        </div>

        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
          {activeViewLib ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ background: '#161616', padding: '10px 20px', borderBottom: '1px solid #252525', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', fontFamily: "'JetBrains Mono', monospace" }}> 
                  <span style={{ color: '#666' }}>READONLY_VFS // </span>
                  {/* 🚀 修正：去掉了多余的 @ 渲染前缀 */}
                  <span style={{ color: '#00ffb3', fontWeight: 'bold' }}>{activeViewLib.name}</span>
                  <span style={{ color: '#888', marginLeft: '6px' }}>(v{activeViewLib.activeVersion})</span>
                  <span style={{ color: '#444', marginLeft: '10px' }}>by {activeViewLib.author}</span>
                </div>
                <button 
                  type="button" 
                  onClick={() => setActiveViewLib(null)}
                  style={{ background: '#222', border: '1px solid #444', color: '#ff5555', padding: '2px 8px', fontSize: '11px', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", borderRadius: '4px' }}
                >
                  Close Preview [✕]
                </button>
              </div>
              <div style={{ flex: 1, width: '100%' }}>
                <Editor
                  height="100%" 
                  theme="ropTheme" 
                  language={ROP_LANG_ID} 
                  value={activeViewLib.versions[activeViewLib.activeVersion]?.code || ""}
                  options={{ 
                    fontSize: 13, minimap: { enabled: false }, readOnly: true,
                    fontFamily: "'JetBrains Mono', monospace", automaticLayout: true,
                    domReadOnly: true
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', letterSpacing: '1px', textTransform: 'uppercase', borderBottom: '1px solid #222', paddingBottom: '8px', marginBottom: '16px' }}>
                Console & Binary Stream
              </div>
              
              {compileOutput && !compileOutput.success && (
                <div style={{ background: '#140c0c', border: '1px solid #5a2323', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ background: '#2c1616', padding: '6px 14px', fontSize: '12px', color: '#ff8888', fontWeight: 'bold' }}>⚠️ COMPILATION_FAILED</div>
                  <pre style={{ margin: 0, padding: '16px', fontSize: '13px', lineHeight: '1.6', color: '#f8f8f2', whiteSpace: 'pre-wrap', textAlign: 'left', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Sans GB", "Microsoft YaHei", sans-serif'}}>
                    {compileOutput.error_message}
                  </pre>
                </div>
              )}

              {compileOutput && compileOutput.success && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ color: '#00ffb3', fontSize: '14px', fontWeight: 'bold' }}>✓ PIPELINE_SUCCESS // BINDINGS_GENERATED</div>
                  {Object.keys(blocks).length === 0 ? (
                    <div style={{ color: '#555', fontStyle: 'italic', padding: '20px', textAlign: 'center', border: '1px dashed #333', borderRadius: '6px' }}>
                      未检测到有效的 block 输出。
                    </div>
                  ) : (
                    Object.keys(blocks).map((blockName) => {
                      const hexStr = blocks[blockName];
                      const bytes = hexStr.match(/.{1,2}/g) || [];
                      const isActive = activeBlockName === blockName;
                      const ranges = isActive ? highlightRanges : [];

                      const rows: string[][] = [];
                      for (let i = 0; i < bytes.length; i += 16) {
                        rows.push(bytes.slice(i, i + 16));
                      }

                      return (
                        <div key={blockName} style={{ background: '#111', borderRadius: '6px', border: '1px solid #262626', overflow: 'hidden' }}>
                          <div style={{ background: '#181818', padding: '8px 16px', borderBottom: '1px solid #262626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff' }}>
                              block <span style={{ color: '#00ffb3' }}>{blockName}</span>
                              {isActive && <span style={{ marginLeft: '8px', color: '#888', fontSize: '12px' }}>◀ 当前高亮</span>}
                            </span>
                          </div>
                          <div style={{ padding: '12px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px', background: '#0d0d0d' }}>
                            {rows.map((row, rowIdx) => (
                              <div key={rowIdx} style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
                                <span style={{ color: '#569cd6', width: '80px', flexShrink: 0 }}>
                                  +0x{(rowIdx * 16).toString(16).toUpperCase().padStart(4, '0')}
                                </span>
                                <span style={{ color: '#333', marginRight: '10px' }}>|</span>
                                <span style={{ display: 'flex', gap: '4px' }}>
                                  {row.map((byteHex, byteIdx) => {
                                    const byteOffset = rowIdx * 16 + byteIdx;
                                    const isHighlighted = ranges.some(r => byteOffset >= r.start && byteOffset < r.end);
                                    return (
                                      <span
                                        key={byteIdx}
                                        style={{
                                          color: isHighlighted ? '#000' : '#ce9178',
                                          backgroundColor: isHighlighted ? '#00ffb3' : 'transparent',
                                          padding: '1px 2px',
                                          borderRadius: '2px',
                                        }}
                                      >
                                        {byteHex.toUpperCase()}
                                      </span>
                                    );
                                  })}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <RopLibraryModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        currentCode={code} 
        vfsLibs={vfsLibs}
        isRefreshing={isRefreshing} // 传入刷新状态
        onManualRefresh={() => refreshVFS(true)} // 传入刷新句柄
        onUpdateVfs={refreshVFS} // 统一使用 refreshVFS 函数
        onDirectViewLib={(lib) => {
          setActiveViewLib(lib);
          setIsModalOpen(false);
        }}
      />
    </div>
  );
}

function getSampleCode(): string {
  // 🚀 修正：内置示例的库导入同步去除了过时的 @ 符号
  return `@import(std_io)

@offset(0xd710)
block main {
    @filler(3)
    .. 11 22 33        
    
    call_gadget(0x123456)
}`;
}