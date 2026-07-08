import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { ROP_LANG_ID, languageDef, configDef } from './ropLanguage';
import { createRopCompletionProvider, createRopHoverProvider, createRopDefinitionProvider } from './ropCompletion';
import type { WebCompileResult, AutocompleteMeta } from './types';
import { getAllVFSLibs, getAllPublicSnippets, saveVFSLib, deleteVFSLib } from './utils/vfs';
import type { ManagedLib, PublicSnippet, LibVersion } from './utils/vfs';

import RopLibraryModal from './components/RopLibraryModal';
import RopInfoModal from './components/RopInfoModal';
import { RopTutorialModal } from './components/RopTutorialModal';

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

  const [cloudVersion, setCloudVersion] = useState<string>('loading...');

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState<boolean>(false);

  const [vfsLibs, setVfsLibs] = useState<ManagedLib[]>([]);
  const [publicSnippets, setPublicSnippets] = useState<PublicSnippet[]>([]);
  const vfsLibsRef = useRef<ManagedLib[]>([]);

  const [activeViewLib, setActiveViewLib] = useState<ManagedLib | null>(null);
  const [activeBlockByCursor, setActiveBlockByCursor] = useState<string | null>(null);
  const [highlightRanges, setHighlightRanges] = useState<{ start: number; end: number }[]>([]);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const compileOutputRef = useRef<WebCompileResult | null>(null);
  const spanMapRef = useRef<Record<string, [number, number, number, number][]>>({});
  const activeBlockRef = useRef<string | null>(null);

  const fetchCloudVersion = useCallback(async () => {
    try {
      // 💡 请求 public/version 物理文件，加时间戳破掉 SW/浏览器缓存
      const response = await fetch(`/version?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache'
        }
      });

      if (response.ok) {
        const text = await response.text();
        setCloudVersion(text.trim()); // 👈 直接拿纯文本，trim 掉可能存在的换行符
      } else {
        setCloudVersion('UNKNOWN');
      }
    } catch (err) {
      console.warn("获取云端静态版本失败:", err);
      setCloudVersion('OFFLINE');
    }
  }, []);

  useEffect(() => {
    // 💡 在 Effect 内部直接声明或包裹异步逻辑
    const loadCloudVersion = async () => {
      try {
        const response = await fetch(`/version?t=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache'
          }
        });

        if (response.ok) {
          const text = await response.text();
          setCloudVersion(text.trim());
        } else {
          setCloudVersion('UNKNOWN');
        }
      } catch (err) {
        console.warn("获取云端静态版本失败:", err);
        setCloudVersion('OFFLINE');
      }
    };

    loadCloudVersion();
    // 💡 保持依赖项数组为空（[]），使其只在组件挂载时无副作用地执行一次
  }, []);

    useEffect(() => {
      vfsLibsRef.current = vfsLibs;
    }, [vfsLibs]);

    const [code, setCode] = useState<string>(() => {
      const cachedData = localStorage.getItem(LOCAL_STORAGE_KEY);
      return cachedData === null || cachedData === '' ? getSampleCode() : cachedData;
    });

    // 在 App.tsx 内注入以下检测逻辑：
    const [isPwaCached, setIsPwaCached] = useState<boolean>(false);

    useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // 💡 1. 封装一个核心状态更新函数
    const checkAndSetPwaStatus = () => {
      if (navigator.serviceWorker.controller) {
        // 只有当前页面真正被 Service Worker 控制了，才算离线资产就绪
        setIsPwaCached(true);
      }
    };

    // 💡 2. 初次挂载时立刻检查一次（如果用户是第二次打开，会直接命中这里）
    checkAndSetPwaStatus();

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      checkAndSetPwaStatus();
    });

    // 💡 4. 保留对正在下载/安装过程的精准追踪（处理非首次打开时的后台静默更新）
    navigator.serviceWorker.ready.then((registration) => {
      // 再次校准
      checkAndSetPwaStatus();

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          // 当新 Worker 状态发生改变时，触发检查
          // 如果新 Worker 成功进入控制状态（或者旧的依然在控制），保持状态正确
          checkAndSetPwaStatus();
        });
      });
    });
  }, []);

  // 🛠️ 1. 修复 refreshVFS 里的 controller 作用域与报错问题
  const refreshVFS = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const localLibs = await getAllVFSLibs();
      const localSnippets = await getAllPublicSnippets();

      const finalLibs = [...localLibs];
      const finalSnippets = [...localSnippets];

      if (navigator.onLine && isOnline) {
        // 💡 正确在 try/catch 同步块作用域内声明 controller
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);

        try {
          const resLibs = await fetch('/api/libs', { signal: controller.signal });
          if (resLibs.ok) {
            const cloudLibs: any[] = await resLibs.json();
            cloudLibs.forEach(cLib => {
              const resolvedName = cLib.name || cLib.title; 
              if (resolvedName && !finalLibs.some(l => l.name === resolvedName && l.isLocal === false)) {
                finalLibs.push({ ...cLib, name: resolvedName, isLocal: false });
              }
            });
          }

          const resSnippets = await fetch('/api/snippets', { signal: controller.signal });
          if (resSnippets.ok) {
            const cloudSnippets: any[] = await resSnippets.json();
            cloudSnippets.forEach(cSnippet => {
              const resolvedTitle = cSnippet.title || cSnippet.name;
              if (resolvedTitle && !finalSnippets.some(s => s.title === resolvedTitle && s.isLocal === false)) {
                finalSnippets.push({ ...cSnippet, title: resolvedTitle, isLocal: false });
              }
            });
          }
        } catch (netErr) {
          console.warn("⚠️ 云端资产同步降级:", netErr);
        } finally {
          clearTimeout(timeout); // 👈 确保定时器被安全清除
        }
      }

      setVfsLibs(finalLibs);
      setPublicSnippets(finalSnippets);
    } catch (err) {
      console.error("VFS 管道刷新崩溃:", err);
    } finally {
      if (isManual) setTimeout(() => setIsRefreshing(false), 300);
    }
  }, [isOnline]);

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
  useEffect(() => { initWasm().then(() => {setWasmReady(true); (window as any).__wasm = { get_autocomplete_metadata, compile_for_web };}).catch(err => console.error("WASM 加载失败:", err)); }, []);

  // 💡 声明一个统一的拖拽状态
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // 👈 阻止默认行为，防止拖动时误选文字
    setIsDragging(true); // 👈 标记开始拖拽

    const startX = e.clientX;
    const startWidth = editorWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      // 动态计算百分比
      const delta = ((moveEvent.clientX - startX) / window.innerWidth) * 100;
      setEditorWidth(Math.min(Math.max(startWidth + delta, 20), 80));
    };

    const onMouseUp = () => {
      setIsDragging(false); // 👈 拖拽结束
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // 移动端防选中与页面滚动
    if (e.cancelable) e.preventDefault(); 
    setIsDragging(true);

    const touch = e.touches[0];
    const startX = touch.clientX;
    // 统一移动端逻辑：如果是百分比，采用与 PC 类似的算法，这里假设你想统一成百分比控制：
    const startWidth = editorWidth; 

    const handleTouchMove = (moveEvent: TouchEvent) => {
      const currentTouch = moveEvent.touches[0];
      const delta = ((currentTouch.clientX - startX) / window.innerWidth) * 100;
      setEditorWidth(Math.min(Math.max(startWidth + delta, 20), 80));
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };
  // WASM 编译器接入：精准匹配 Rust 层 fetch_lib_fn(lib_name)
  const compileOutput = useMemo<WebCompileResult | null>(() => {
    if (!wasmReady) return null;

    let interceptedError: { message: string; line: number; column: number } | null = null;

    try {
      const nativeResult = compile_for_web(code, (libName: string) => {
        // 💡 遵循 Rust 接口规范：此处接收到的 libName 为纯库名字符串
        // 优先查找被锁定的本地 VFS 镜像，找不到则查找云端同步镜像
        const targetLib = vfsLibs.find(l => l.name === libName && l.isLocal) || 
                          vfsLibs.find(l => l.name === libName);

        if (!targetLib) {
          let errorLine = 1;
          let errorColumn = 1;
          const lines = code.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`@import`) && lines[i].includes(libName)) {
              errorLine = i + 1;
              errorColumn = lines[i].indexOf('@import') + 1;
              break;
            }
          }
          interceptedError = {
            message: `[VFS LINK DISASTER]: 找不到指定的映射依赖项 "@import(${libName})"。`,
            line: errorLine,
            column: errorColumn
          };
          return ""; 
        }

        // 💡 因为 Rust 语法不显式传递版本，默认使用用户在 VFS 中指定的 activeVersion
        const versionToFetch = targetLib.activeVersion;
        const finalCode = targetLib.versions[versionToFetch]?.code;

        if (finalCode === undefined || finalCode === null) {
          let errorLine = 1;
          let errorColumn = 1;
          const lines = code.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`@import`) && lines[i].includes(libName)) {
              errorLine = i + 1;
              errorColumn = lines[i].indexOf('@import') + 1;
              break;
            }
          }
          interceptedError = {
            message: `[VFS VERSION MISMATCH]: 依赖项 "${libName}" 缺失活动版本号 [v${versionToFetch}]。`,
            line: errorLine,
            column: errorColumn
          };
          return "";
        }

        return finalCode;
      }) as WebCompileResult;

      // 💡 WASM 出来后，立刻检查有没有触发拦截
      if (interceptedError) {
        const err = interceptedError as { message: string; line: number; column: number }; // 让编译器和Linter不犯蠢
        return {
          success: false,
          error_message: err.message,
          blocks: {},
          line: err.line,
          column: err.column
        } as any;
      }

      return nativeResult;

    } catch (e: any) {
      console.error("[CRITICAL WASM CRASH]:", e);
      return { 
        success: false, 
        error_message: "WASM 引擎崩溃: " + (e?.message || e), 
        blocks: {},
        line: 1,
        column: 1
      } as any;
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
      const importPattern = /^@import\s*\(\s*([a-zA-Z_]\w*)\s*\)(?:\s*\/\/.*)?\s*$/;
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

    const getAvailableLibNames = (): string[] => {
      return vfsLibsRef.current.map(lib => lib.name);
    };

    // 自动补全 (传入两个回调，分别用于宏/内建提示解析，以及 @import 库名补全提示)
    monaco.languages.registerCompletionItemProvider(
      ROP_LANG_ID,
      createRopCompletionProvider(getAutocompleteMetaWithLibs, getAvailableLibNames)
    );

    // 辅助函数：获取 def 区间
    // 💡 修改 App.tsx 内部 handleEditorWillMount 里的 getDefIntervals
    function getDefIntervals(codeText: string): Array<{ start: number; end: number }> {
      const lines = codeText.split('\n');
      const intervals: Array<{ start: number; end: number }> = [];
      // 兼容 $ 开头的宏定义
      const defStartRegex = /(?:\b|(?=\$))def\s+(?:[a-zA-Z_]\w*|\$\S+)/;
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
              endLine = j + 1;
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

      // 转义 word，防止带有特殊字符损坏正则
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const labelDefRegex = new RegExp(`^\\s*(${escapedWord})\\s*:`);
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
        {/* 左侧区域：标题与控制键 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#00ffb3' }}>ROP IDE 2nd</h2>
          
          {/* 版本流展示区域 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 'bold' }}>
            {/* 本地代码版本 */}
            <span style={{ color: '#909090' }}>LOCAL:{pkg.version}</span>
            
            {/* 分隔符 */}
            <span style={{ color: '#333' }}>/</span>
            
            {/* 云端最新版本 */}
            <span style={{ 
              color: cloudVersion === 'loading...' ? '#666' : (cloudVersion === pkg.version ? '#38bdf8' : '#ff5555'),
              background: cloudVersion !== 'loading...' && cloudVersion !== pkg.version ? 'rgba(255, 85, 85, 0.15)' : 'transparent',
              padding: cloudVersion !== 'loading...' && cloudVersion !== pkg.version ? '2px 6px' : '0',
              borderRadius: '4px',
              border: cloudVersion !== 'loading...' && cloudVersion !== pkg.version ? '1px solid rgba(255, 85, 85, 0.3)' : 'none',
              transition: 'all 0.3s'
            }}>
              CLOUD:{cloudVersion}
            </span>
          </div>
          
          <button 
            type="button"
            onClick={() => setIsModalOpen(true)}
            style={{ background: '#222', border: '1px solid #333', color: '#00ffb3', padding: '4px 12px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#2a2a2a'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#222'}
          >
            📦 公共库/Global Library
          </button>

          <button 
            type="button"
            onClick={() => setIsInfoOpen(true)}
            style={{ background: '#222', border: '1px solid #333', color: '#38bdf8', padding: '4px 12px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#2a2a2a'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#222'}
          >
            📰 信息/Notes
          </button>

          <button 
            type="button"
            onClick={() => setIsTutorialOpen(true)}
            style={{ background: '#222', border: '1px solid #333', color: '#38bdf8', padding: '4px 12px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#2a2a2a'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#222'}
          >
            📖 教程/Tutorial
          </button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
          
          {/* PWA 离线缓存就绪指示灯 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#111', padding: '4px 12px', borderRadius: '20px', border: '1px solid #222', flexShrink: 0 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isPwaCached ? '#38bdf8' : '#eab308', boxShadow: isPwaCached ? '0 0 8px #38bdf8' : '0 0 8px #eab308' }} />
            <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: isPwaCached ? '#aaa' : '#eab308' }}>
              {isPwaCached ? 'OFFLINE_ASSETS_READY' : 'DOWNLOADING_ASSETS...'}
            </span>
          </div>

          {/* 网络在线状态指示灯 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#111', padding: '4px 12px', borderRadius: '20px', border: '1px solid #222', flexShrink: 0 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? '#00ffb3' : '#ff5555', boxShadow: isOnline ? '0 0 8px #00ffb3' : '0 0 8px #ff5555' }} />
            <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: isOnline ? '#aaa' : '#ff8888' }}>
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>

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

        {/* 优化后的中央分割线 */}
        <div 
          onMouseDown={handleMouseDown} 
          onTouchStart={handleTouchStart} 
          style={{ 
            width: '10px',
            margin: '0 -2px',           // 负 margin 产生隐形热区，完全不撑开/破坏两边编辑器的原有像素位置
            background: isDragging ? '#1fd8a1' : '#222', // 👈 核心：由状态驱动背景色，快速滑动绝不熄灭
            cursor: 'col-resize',       
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            zIndex: 10,
            transition: 'background 0.2s ease, box-shadow 0.2s ease',
            boxShadow: isDragging ? '0 0 8px #1fd8a1' : 'none', // 选中时带有一层极轻的荧光外发光
          }}
          // 仅在非拖拽状态下响应普通的 Hover
          onMouseEnter={(e) => {
            if (!isDragging) {
              e.currentTarget.style.background = '#333';
              e.currentTarget.style.boxShadow = '0 0 0 1px #444';
            }
          }}
          onMouseLeave={(e) => {
            if (!isDragging) {
              e.currentTarget.style.background = '#222';
              e.currentTarget.style.boxShadow = 'none';
            }
          }}
        >
          {/* 中间的装饰刻度线 */}
          <div style={{ 
            width: '2px', 
            height: '30px', 
            background: isDragging ? '#000' : '#444', // 激活时装饰线变暗，反衬亮色底
            pointerEvents: 'none',
            transition: 'background 0.2s ease'
          }} />
        </div>

        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
          {activeViewLib ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ background: '#161616', padding: '10px 20px', borderBottom: '1px solid #252525', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', fontFamily: "'JetBrains Mono', monospace" }}> 
                  <span style={{ color: '#666' }}>READONLY_VFS // </span>
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
                  <pre style={{ margin: 0, padding: '16px', fontSize: '13px', lineHeight: '1.6', color: '#f8f8f2', whiteSpace: 'pre-wrap', textAlign: 'left', fontFamily: 'Consolas, "Microsoft YaHei", sans-serif'}}>
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
        publicSnippets={publicSnippets} // 传入全新 V2 版本的片段数组
        isRefreshing={isRefreshing}
        onManualRefresh={() => refreshVFS(true)}
        onUpdateVfs={refreshVFS}
        onDirectViewLib={(lib) => {
          // 依赖库的常规查看（不覆盖工作区）
          setActiveViewLib(lib);
          setIsModalOpen(false);
        }}
        onOverwriteWorkarea={(freshCode) => {
          setCode(freshCode); 
        }}
      />
      <RopInfoModal 
        isOpen={isInfoOpen} 
        onClose={() => setIsInfoOpen(false)} 
        pwaVersion={pkg.version} 
      />
      <RopTutorialModal 
        isOpen={isTutorialOpen} 
        onClose={() => setIsTutorialOpen(false)} 
      />
    </div>
  );
}

function getSampleCode(): string {
  return `
@offset(0xd710)
block main {}`;
}