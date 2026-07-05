import { version } from '../package.json';
import { useEffect, useState, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { ROP_LANG_ID, languageDef, configDef } from './ropLanguage';
import { createRopCompletionProvider, createRopDefinitionProvider, createRopHoverProvider } from './ropCompletion';
import type { WebCompileResult, AutocompleteMeta } from './types';


import initWasm, { compile_for_web, get_autocomplete_metadata } from './wasm_pkg/rop_compiler';

const LOCAL_STORAGE_KEY = 'rop_ide_source_code_cache';

export default function App() {
  const [wasmReady, setWasmReady] = useState<boolean>(false);
  const [editorWidth, setEditorWidth] = useState<number>(58); 

  // 【核心功能】：只有当缓存彻底为空（或者首次打开）时，刷新才填入示例代码
  const [code, setCode] = useState<string>(() => {
    const cachedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (cachedData === null || cachedData === '') {
      return getSampleCode();
    }
    return cachedData;
  });

  // 用户的代码一旦改变，立即存入本地持久化缓存（包括空字符串也会被如实记录）
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, code);
  }, [code]);

  // 完美解决时序问题的 Service Worker 注册逻辑
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const registerSW = () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            console.log('Service Worker 注册成功，离线就绪: ', reg.scope);
          })
          .catch((err) => {
            console.error('Service Worker 注册失败: ', err);
          });
      };

      // 如果页面已经加载完毕，直接注册；否则等待加载完再注册
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        registerSW();
      } else {
        window.addEventListener('load', registerSW);
      }
    } else {
      console.warn('当前浏览器不支持 Service Worker');
    }
  }, []);

  useEffect(() => {
    initWasm()
      .then(() => setWasmReady(true))
      .catch((err: unknown) => console.error("WASM 加载失败:", err));
  }, []);

  // 边栏拖动逻辑
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

  // 渲染时计算编译输出
  const compileOutput = useMemo<WebCompileResult | null>(() => {
    if (!wasmReady) return null;
    try {
      return compile_for_web(code) as WebCompileResult;
    } catch (e) {
      console.error(e);
      return { success: false, error_message: "WASM 执行崩溃", blocks: {} };
    }
  }, [code, wasmReady]);

  const blocks = useMemo(() => {
    if (!compileOutput || !compileOutput.blocks) return {};
    return compileOutput.blocks instanceof Map 
      ? Object.fromEntries(compileOutput.blocks) 
      : compileOutput.blocks;
  }, [compileOutput]);

  const handleEditorWillMount = (monaco: Monaco) => {
    monaco.languages.register({ id: ROP_LANG_ID });
    monaco.languages.setMonarchTokensProvider(ROP_LANG_ID, languageDef as any);
    monaco.languages.setLanguageConfiguration(ROP_LANG_ID, configDef as any);

    // 自定义高亮颜色主题体系
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
          { token: 'rop.hex', foreground: '#0CD4AF' },                              // 长地址常数
          { token: 'rop.comment', foreground: '#6A9955', fontStyle: 'italic' }     // 代码注释：斜体幽灵绿
      ],
      colors: {
          'editor.background': '#151515', 
          'editor.foreground': '#D4D4D4'
      }
    });

    monaco.editor.setTheme('ropTheme');

    // 1. 自动补全提供者
    monaco.languages.registerCompletionItemProvider(
      ROP_LANG_ID, 
      createRopCompletionProvider((src) => get_autocomplete_metadata(src) as AutocompleteMeta)
    );

    // 2. 作用域隔离跳转 (Ctrl+点击)
    monaco.languages.registerDefinitionProvider(
      ROP_LANG_ID,
      createRopDefinitionProvider()
    );

    // 3. 宏悬停文档提示 (Hover)
    monaco.languages.registerHoverProvider(
      ROP_LANG_ID,
      createRopHoverProvider((src) => get_autocomplete_metadata(src) as AutocompleteMeta)
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#121212', color: '#e0e0e0', position: 'fixed', top: 0, left: 0}}>
      {/* 顶部状态栏 */}
      <div style={{ padding: '12px 24px', background: '#1a1a1a', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#00ffb3' }}>ROP IDE 2nd Edition</h2>
          <span style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>v{version}</span>
        </div>
        <span style={{ fontSize: '11px', color: '#888' }}>离线支持已启用 (PWA)</span>
      </div>

      <div style={{ display: 'flex', flex: 1, width: '100%' }}>
        {/* 代码编辑区 */}
        <div style={{ width: `${editorWidth}%`, height: '100%' }}>
          <Editor
            height="100%"
            theme="ropTheme"
            language={ROP_LANG_ID}
            value={code}
            onChange={(val) => setCode(val ?? '')}
            beforeMount={handleEditorWillMount}
            options={{ 
              fontSize: 14,
              minimap: { enabled: false }, 
              fontFamily: "'JetBrains Mono', monospace",
              automaticLayout: true,
              lineNumbersMinChars: 4
            }}
          />
        </div>

        {/* 拖拽分割条 */}
        <div 
          onMouseDown={handleMouseDown}
          style={{ width: '6px', background: '#222', cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.background = '#333'}
          onMouseOut={(e) => e.currentTarget.style.background = '#222'}
        >
          <div style={{ width: '2px', height: '30px', background: '#444' }} />
        </div>

        {/* 终端编译流输出面板 */}
        <div style={{ flex: 1, height: '100%', overflowY: 'auto', padding: '24px', textAlign: 'left', fontFamily: "'JetBrains Mono'", fontSize: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', letterSpacing: '1px', textTransform: 'uppercase', borderBottom: '1px solid #222', paddingBottom: '8px', marginBottom: '16px' }}>
            Console & Binary Stream
          </div>
          
          {compileOutput && !compileOutput.success && (
            <div style={{ background: '#140c0c', border: '1px solid #5a2323', borderRadius: '6px', overflow: 'hidden' }}>
              <div style={{ background: '#2c1616', padding: '6px 14px', fontSize: '12px', color: '#ff8888', fontWeight: 'bold' }}>⚠️ COMPILATION_FAILED</div>
              <pre style={{ margin: 0, padding: '16px', fontSize: '14px', lineHeight: '1.6', color: '#f8f8f2', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                {compileOutput.error_message}
              </pre>
            </div>
          )}

          {compileOutput && compileOutput.success && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ color: '#00ffb3', fontSize: '14px', fontWeight: 'bold' }}>✓ PIPELINE_SUCCESS // BINDINGS_GENERATED</div>
              
              {Object.keys(blocks).length === 0 ? (
                <div style={{ color: '#555', fontStyle: 'italic', padding: '20px', textAlign: 'center', border: '1px dashed #333', borderRadius: '6px' }}>
                  未检测到有效的 block 输出。请确保源码中包含正确定义的 block 节点。
                </div>
              ) : (
                Object.keys(blocks).map((blockName) => {
                  const hexStr = blocks[blockName];
                  const chunks = hexStr.match(/.{1,32}/g) || [];
                  
                  const downloadData = (ext: string) => {
                    let blob: Blob;
                    if (ext === 'bin') {
                      const byteArray = new Uint8Array(hexStr.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || []);
                      blob = new Blob([byteArray], { type: 'application/octet-stream' });
                    } else {
                      blob = new Blob([hexStr], { type: 'text/plain' });
                    }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${blockName}.${ext}`;
                    a.click();
                  };

                  return (
                    <div key={blockName} style={{ background: '#111', borderRadius: '6px', border: '1px solid #262626', overflow: 'hidden' }}>
                      <div style={{ background: '#181818', padding: '8px 16px', borderBottom: '1px solid #262626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff' }}>
                          block <span style={{ color: '#00ffb3' }}>{blockName}</span>
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => navigator.clipboard.writeText(hexStr).then(() => alert('已复制'))} style={{ fontSize: '12px', background: '#00ffb3', border: 'none', color: '#000', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer' }}>Copy</button>
                          <button onClick={() => downloadData('txt')} style={{ fontSize: '12px', background: '#222', border: '1px solid #333', color: '#ccc', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer' }}>.txt</button>
                          <button onClick={() => downloadData('bin')} style={{ fontSize: '12px', background: '#222', border: '1px solid #333', color: '#ccc', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer' }}>.bin</button>
                        </div>
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
      </div>
    </div>
  );
}

function getSampleCode(): string {
  return `def call_gadget(target_addr) {
    _label:
    A8 21     
    yield         
    [_label]
}

@offset(0xd710)
block main {
    @filler(3)
    .. 11 22 33        
                
    gadget_pop_rdi:
    call_gadget(( gadget_pop_rdi | 0x0001 )){
        a8 23 
    }
    gadget_shell | &gadget_shell
    5F C3
    gadget_shell:
    AA BB CC DD EE FF
}`;
}