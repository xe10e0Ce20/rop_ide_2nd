// src/App.tsx
import { useEffect, useState, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { ROP_LANG_ID, languageDef, configDef } from './ropLanguage';

// @ts-expect-error - WASM module lacks default types
import initWasm, { compile_for_web, get_autocomplete_metadata } from './wasm_pkg/rop_compiler';

interface WebCompileResult {
  success: boolean;
  error_message: string | null;
  blocks: Record<string, string>;
}

interface AutocompleteMeta {
  macro_names: string[];
  macro_details: Record<string, string[]>;
}

export default function App() {
  const [wasmReady, setWasmReady] = useState<boolean>(false);
  const [code, setCode] = useState<string>(getSampleCode());

  const [editorWidth, setEditorWidth] = useState<number>(60); 

    // 边栏拖动逻辑
    const handleMouseDown = (e: React.MouseEvent) => {
      const startX = e.clientX;
      const startWidth = editorWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = ((moveEvent.clientX - startX) / window.innerWidth) * 100;
        setEditorWidth(Math.min(Math.max(startWidth + delta, 20), 80)); // 限制在 20% 到 80% 之间
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

  useEffect(() => {
    initWasm()
      .then(() => setWasmReady(true))
      .catch((err: unknown) => console.error("WASM 加载失败:", err));
  }, []);

  // 渲染时计算编译输出
  const compileOutput = useMemo<WebCompileResult | null>(() => {
    if (!wasmReady) return null;
    try {
      const res = compile_for_web(code);
      return res as WebCompileResult;
    } catch (e) {
      console.error(e);
      return { success: false, error_message: "WASM 执行崩溃", blocks: {} };
    }
  }, [code, wasmReady]);

  const handleEditorWillMount = (monaco: Monaco) => {
    monaco.languages.register({ id: ROP_LANG_ID });
    monaco.languages.setMonarchTokensProvider(ROP_LANG_ID, languageDef as unknown as typeof monaco.languages.encodedTokenAttributes.TokensProvider);
    monaco.languages.setLanguageConfiguration(ROP_LANG_ID, configDef as unknown as typeof monaco.languages.languages.LanguageConfiguration);

    monaco.languages.registerCompletionItemProvider(ROP_LANG_ID, {
      provideCompletionItems: (model: typeof monaco.editor.ITextModel) => {
        const currentCode = model.getValue();
        const meta = get_autocomplete_metadata(currentCode) as AutocompleteMeta;
        
        const suggestions = (meta.macro_names || []).map((name: string) => {
          const params: string[] = meta.macro_details[name] || [];
          const paramStr = params.join(', ');
          return {
            label: name,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `${name}(${params.map((p: string, i: number) => `\${${i + 1}:${p}}`).join(', ')})`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: `Macro Def: (${paramStr})`,
            range: undefined as unknown as typeof monaco.languages.languages.IRange
          };
        });

        return { suggestions: suggestions as unknown as typeof monaco.languages.languages.CompletionItem[] };
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#121212', color: '#e0e0e0', position: 'fixed', top: 0, left: 0}}>
      <div style={{ padding: '12px 24px', background: '#1a1a1a', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#00ffb3' }}>ROP IDE 2nd_Edition</h2>
        <span style={{ fontSize: '11px', color: '#888' }}>v0.0.1</span>
      </div>

      {/* 主工作区 */}
      <div style={{ display: 'flex', flex: 1, width: '100%' }}>
        {/* 编辑器区域 */}
        <div style={{ width: `${editorWidth}%`, height: '100%' }}>
          <Editor
            height="100%"
            theme="vs-dark"
            language={ROP_LANG_ID}
            value={code}
            onChange={(val) => setCode(val || '')}
            beforeMount={handleEditorWillMount}
            options={{ 
              fontSize: 14,
              minimap: { enabled: false }, 
              automaticLayout: true,
              lineNumbersMinChars: 4
            }}
          />
        </div>

        {/* 可拖动分隔条 */}
        <div 
          onMouseDown={handleMouseDown}
          style={{ 
            width: '6px', 
            background: '#222', 
            cursor: 'col-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#333'}
          onMouseOut={(e) => e.currentTarget.style.background = '#222'}
        >
          <div style={{ width: '2px', height: '30px', background: '#444' }} />
        </div>

        {/* Diagnostic & Output Panel */}
        <div style={{ flex: 1, height: '100%', overflowY: 'auto', padding: '24px', textAlign: 'left' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', letterSpacing: '1px', textTransform: 'uppercase', borderBottom: '1px solid #222', paddingBottom: '8px' }}>
            Console & Binary Stream
          </div>
          
          {/* 1. 编译错误状态显示框（强行使用等宽并套用终端样式面板） */}
          {compileOutput && !compileOutput.success && (
            <div style={{ 
              background: '#140c0c', 
              border: '1px solid #5a2323', 
              borderRadius: '6px', 
              overflow: 'hidden',
              fontFamily: "'Fira Code', 'Courier New', monospace" 
            }}>
              <div style={{ background: '#2c1616', padding: '6px 14px', fontSize: '12px', color: '#ff8888', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⚠️</span> COMPILATION_FAILED
              </div>
              <pre style={{ 
                margin: 0, 
                padding: '16px', 
                fontSize: '13px', 
                lineHeight: '1.6', 
                color: '#f8f8f2', 
                whiteSpace: 'pre-wrap',
                overflowX: 'auto'
              }}>
                {compileOutput.error_message}
              </pre>
            </div>
          )}

          {/* 2. 编译成功后输出的独立区块拓扑级联视图 */}
          {compileOutput && compileOutput.success && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ color: '#00ffb3', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>✓</span> PIPELINE_SUCCESS // BINDINGS_GENERATED
              </div>
              
              {Object.keys(compileOutput.blocks).length === 0 ? (
                <div style={{ color: '#555', fontSize: '13px', fontStyle: 'italic', padding: '20px', textAlign: 'center', border: '1px dashed #333', borderRadius: '6px' }}>
                  未检测到有效的 block 输出。请确保源码中包含正确定义的 block 节点。
                </div>
              ) : (
                Object.keys(compileOutput.blocks).map((blockName) => {
                  const hexStr = compileOutput.blocks[blockName];
                  // 按 8 个字符（4字节）分组一条流水线
                  const chunks = hexStr.match(/.{1,8}/g) || [];
                  
                  return (
                    <div key={blockName} style={{ 
                      background: '#111', 
                      borderRadius: '6px', 
                      border: '1px solid #262626',
                      overflow: 'hidden',
                      fontFamily: "'Fira Code', 'Courier New', monospace"
                    }}>
                      {/* Block 头部装饰 */}
                      <div style={{ background: '#181818', padding: '8px 16px', borderBottom: '1px solid #262626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#fff' }}>
                          block <span style={{ color: '#00ffb3' }}>{blockName}</span>
                        </span>
                        <span style={{ fontSize: '11px', color: '#555' }}>
                          [{chunks.length * 4} Bytes]
                        </span>
                      </div>
                      
                      {/* 内存拓扑网格表格布局 */}
                      <div style={{ padding: '16px', fontSize: '13px', lineHeight: '1.7', color: '#a9b7c6', background: '#0d0d0d' }}>
                        {chunks.map((chunk, index) => {
                          // 将 4 字节拆开成独立的单字节如: "AA BB CC DD"
                          const bytes = chunk.match(/.{1,2}/g)?.join(' ') || '';
                          return (
                            <div key={index} style={{ display: 'flex', borderBottom: '1px solid #141414', padding: '4px 0' }}>
                              {/* 相对地址列 */}
                              <span style={{ color: '#569cd6', width: '80px', flexShrink: 0, userSelect: 'none' }}>
                                +{ (index * 4).toString(16).toUpperCase().padStart(4, '0') }
                              </span>
                              {/* 管道分割线 */}
                              <span style={{ color: '#333', marginRight: '16px', userSelect: 'none' }}>|</span>
                              {/* 纯正原始十六进制字节流数据区 */}
                              <span style={{ color: '#ce9178', letterSpacing: '0.5px' }}>
                                {bytes.toUpperCase()}
                              </span>
                            </div>
                          );
                        })}
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