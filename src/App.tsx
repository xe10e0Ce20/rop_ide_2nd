import { useEffect, useState, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { ROP_LANG_ID, languageDef, configDef } from './ropLanguage';
import { createRopCompletionProvider, createRopHoverProvider, createRopDefinitionProvider } from './ropCompletion';
import type { WebCompileResult, AutocompleteMeta } from './types';
import RopLibraryModal from './components/RopLibraryModal';

import initWasm, { compile_for_web, get_autocomplete_metadata } from './wasm_pkg/rop_compiler';

const LOCAL_STORAGE_KEY = 'rop_ide_source_code_cache';

interface LibItem {
  name: string;
  author: string;
  description: string;
  code: string;
  updatedAt: number;
}

export default function App() {
  const [wasmReady, setWasmReady] = useState<boolean>(false);
  const [editorWidth, setEditorWidth] = useState<number>(58); 
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [globalLibs, setGlobalLibs] = useState<LibItem[]>([]);
  const globalLibsRef = useRef<LibItem[]>([]);

  const [activeViewLib, setActiveViewLib] = useState<LibItem | null>(null);

  // 用来控制和刷新 Monaco Markers 的引用
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  useEffect(() => {
    globalLibsRef.current = globalLibs;
  }, [globalLibs]);

  const [code, setCode] = useState<string>(() => {
    const cachedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    return cachedData === null || cachedData === '' ? getSampleCode() : cachedData;
  });

  // 初始化同步公共库列表
  useEffect(() => {
    fetch('/api/libs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setGlobalLibs(data);
      })
      .catch((err) => console.error("初始化同步公共库失败:", err));
  }, []); 

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

  // 核心编译计算项
  const compileOutput = useMemo<WebCompileResult | null>(() => {
    if (!wasmReady) return null;
    try {
      return compile_for_web(code, (libName: string) => {
        const targetLib = globalLibs.find(l => l.name === libName);
        return targetLib ? targetLib.code : "";
      }) as WebCompileResult;
    } catch (e) {
      console.error(e);
      return { success: false, error_message: "WASM 执行崩溃", blocks: {} };
    }
  }, [code, wasmReady, globalLibs]);

  // ==================== 错误波浪线（Markers）同步驱动 ====================
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    // 只要编译成功，或者没有产生有效的编译输出，就清除所有报错标记
    if (!compileOutput || compileOutput.success) {
      monaco.editor.setModelMarkers(model, "rop_compiler", []);
      return;
    }

    // 编译失败，且后端清洗出了精确的行号和列号
    if (compileOutput.line !== undefined && compileOutput.line !== null &&
        compileOutput.column !== undefined && compileOutput.column !== null) {
      
      const errLine = compileOutput.line;
      // 使用 ?? 1 彻底断绝零或 null 的可能性，让 TS 闭嘴
      const errCol = compileOutput.column ?? 1; 
      
      // 提取错误发生行的文本，用来智能化决定波浪线高亮的右边界长度
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
      // 兜底：如果有些未定义错误没拿到行列，也先清空旧标记，防止残留在不相干的行
      monaco.editor.setModelMarkers(model, "rop_compiler", []);
    }
  }, [compileOutput]);

  const blocks = useMemo(() => {
    if (!compileOutput || !compileOutput.blocks) return {};
    return compileOutput.blocks instanceof Map ? Object.fromEntries(compileOutput.blocks) : compileOutput.blocks;
  }, [compileOutput]);

  const handleEditorWillMount = (monaco: Monaco) => {
    monaco.languages.register({ id: ROP_LANG_ID });
    monaco.languages.setMonarchTokensProvider(ROP_LANG_ID, languageDef as any);
    monaco.languages.setLanguageConfiguration(ROP_LANG_ID, configDef as any);

    monaco.editor.defineTheme('ropTheme', {
      base: 'vs-dark', 
      inherit: true,   
      rules: [
          { token: 'rop.keyword', foreground: '#C586C0', fontStyle: 'bold' },      // 核心控制流关键字
          { token: 'rop.directive', foreground: '#CE9178' },                        // 编译器指令
          { token: 'rop.label.definition', foreground: '#D9662C', fontStyle: 'bold' }, // 标签定义
          { token: 'rop.label.reference', foreground: '#4FC1FF' },                 // 标签调用
          { token: 'rop.label.rawrefrence', foreground: '#8BE9FD' },                  // 标签原始引用（&）
          { token: 'rop.macro.call', foreground: '#DCDCAA' },                      // 宏函数调用
          { token: 'rop.bytecode', foreground: '#B5CEA8' },                        // 严格机器码字节
          { token: 'rop.hex', foreground: '#0CD4AF' },                             // 长地址常数
          { token: 'rop.comment', foreground: '#6A9955', fontStyle: 'italic' }     // 代码注释
      ],
      colors: {
          'editor.background': '#151515', 
          'editor.foreground': '#D4D4D4'
      }
    });

    monaco.editor.setTheme('ropTheme');

    const getAugmentedSourceForMetadata = (src: string): string => {
    const lines = src.split('\n');
    const importPattern = /^@import\s*\(\s*([a-zA-Z_]\w*)\s*\)\s*$/;
    const libNames: string[] = [];

    for (const line of lines) {
      const match = line.trim().match(importPattern);
      if (match) {
        libNames.push(match[1]);
      }
    }

    if (libNames.length === 0) return src;

    // 从 globalLibsRef 获取对应库代码
    const libCodeBlocks = libNames
      .map(name => {
        const lib = globalLibsRef.current.find(l => l.name === name);
        return lib ? lib.code : '';
      })
      .filter(code => code.length > 0);

    // 把所有库代码拼接到当前源码后面（不影响主文件的语法解析，因为 macro_def 可以出现在任何位置）
    return src + '\n' + libCodeBlocks.join('\n');
  };

  // 创建带库支持的 metadata 回调
  const getAutocompleteMetaWithLibs = (src: string): AutocompleteMeta => {
    const augmentedSource = getAugmentedSourceForMetadata(src);
    return get_autocomplete_metadata(augmentedSource) as AutocompleteMeta;
  };

    // 1. 自动补全
    monaco.languages.registerCompletionItemProvider(
      ROP_LANG_ID, 
      createRopCompletionProvider(getAutocompleteMetaWithLibs)
    );

    // 静态分析提取引擎：精准定位地址标签与其头部注释
    const getLabelDefinition = (word: string, codeText: string) => {
      const lines = codeText.split('\n');
      const labelDefRegex = new RegExp(`^\\s*(${word})\\s*:`);
      
      for (let i = 0; i < lines.length; i++) {
        if (labelDefRegex.test(lines[i])) {
          const commentLines: string[] = [];
          let p = i - 1;
          while (p >= 0) {
            const trimmed = lines[p].trim();
            if (trimmed.startsWith('//')) {
              commentLines.unshift(trimmed.replace(/^\/\/+/, '').trim());
              p--;
            } else if (trimmed === '') {
              p--; 
            } else {
              break;
            }
          }
          return {
            line: i + 1,
            comment: commentLines.join('\n')
          };
        }
      }
      return null;
    };

    // 2. 增强型 Hover 悬停提示
    const nativeHoverProvider = createRopHoverProvider(getAutocompleteMetaWithLibs);
    monaco.languages.registerHoverProvider(ROP_LANG_ID, {
      provideHover: async (model: any, position: any) => {
        const wordInfo = model.getWordAtPosition(position);
        if (!wordInfo) return null;

        const nativeResult = await Promise.resolve(nativeHoverProvider.provideHover(model, position));
        if (nativeResult) {
          return nativeResult; 
        }

        const labelInfo = getLabelDefinition(wordInfo.word, model.getValue());
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

    // 3. 增强型 Definition Provider (Ctrl+点击跳转)
    const nativeDefinitionProvider = createRopDefinitionProvider();
    monaco.languages.registerDefinitionProvider(ROP_LANG_ID, {
      provideDefinition: async (model: any, position: any) => {
        const wordInfo = model.getWordAtPosition(position);
        if (!wordInfo) return null;

        const nativeDef = await Promise.resolve(nativeDefinitionProvider.provideDefinition(model, position));
        if (nativeDef) {
          return nativeDef;
        }

        const labelInfo = getLabelDefinition(wordInfo.word, model.getValue());
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

  // 捕获编辑器与 monaco 的原生实例
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#121212', color: '#e0e0e0', position: 'fixed', top: 0, left: 0}}>
      {/* 顶部状态栏 */}
      <div style={{ padding: '12px 24px', background: '#1a1a1a', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#00ffb3' }}>ROP IDE</h2>
          <span style={{ fontSize: '12px', color: '#666', fontFamily: "'JetBrains Mono', monospace", fontWeight: 'bold' }}>v0.0.1</span>
          
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
                  <span style={{ color: '#00ffb3', fontWeight: 'bold' }}>@{activeViewLib.name}</span>
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
                  height="100%" theme="ropTheme" language={ROP_LANG_ID} value={activeViewLib.code}
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
                  <pre style={{ margin: 0, padding: '16px', fontSize: '13px', lineHeight: '1.6', color: '#f8f8f2', whiteSpace: 'pre-wrap' }}>
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
                      const chunks = hexStr.match(/.{1,32}/g) || [];
                      return (
                        <div key={blockName} style={{ background: '#111', borderRadius: '6px', border: '1px solid #262626', overflow: 'hidden' }}>
                          <div style={{ background: '#181818', padding: '8px 16px', borderBottom: '1px solid #262626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff' }}>block <span style={{ color: '#00ffb3' }}>{blockName}</span></span>
                          </div>
                          <div style={{ padding: '12px 16px', fontSize: '14px', lineHeight: '1.6', color: '#a9b7c6', background: '#0d0d0d' }}>
                            {chunks.map((chunk: string, index: number) => (
                              <div key={index} style={{ display: 'flex', padding: '2px 0' }}>
                                <span style={{ color: '#569cd6', width: '80px', flexShrink: 0 }}>+0x{(index * 16).toString(16).toUpperCase().padStart(4, '0')}</span>
                                <span style={{ color: '#333', marginRight: '10px' }}>|</span>
                                <span style={{ color: '#ce9178', letterSpacing: '0.5px' }}>{(chunk.match(/.{1,2}/g)?.join(' ') || '').toUpperCase()}</span>
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
        onImportCode={(importedCode) => setCode(importedCode)}
        onRefreshLibs={(libs) => setGlobalLibs(libs)}
        onDirectViewLib={(lib) => {
          setActiveViewLib(lib);
          setIsModalOpen(false);
        }}
      />
    </div>
  );
}

function getSampleCode(): string {
  return `@import(std_io)

@offset(0xd710)
block main {
    @filler(3)
    .. 11 22 33        
    
    call_gadget(0x123456)
}`;
}