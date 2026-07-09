// src/components/RopInfoModal.tsx
import React from 'react';
import pkg from '../../package.json';

interface RopInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  pwaVersion?: string;
}

export default function RopInfoModal({ isOpen, onClose, pwaVersion = pkg.version }: RopInfoModalProps) {
  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }}>
      <div style={{ background: '#161616', border: '1px solid #333', borderRadius: '8px', width: '600px', maxWidth: '90%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
        
        {/* Header - 靠左对齐 */}
        <div style={{ padding: '16px 24px', background: '#1a1a1a', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#38bdf8', fontFamily: "'JetBrains Mono', monospace", textAlign: 'left' }}>
            PROJECT_METADATA // ROP_IDE_SYSTEM
          </span>
          <button 
            type="button" 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px' }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ff5555'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
          >
            ✕
          </button>
        </div>

        {/* Document Body - 全都靠左对齐 */}
        <div style={{ padding: '24px', overflowY: 'auto', maxHeight: '70vh', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: '14px', lineHeight: '1.6', color: '#ccc', textAlign: 'left' }}>
          
          {/* GitHub Repositories */}
          <h3 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '15px', textAlign: 'left' }}> 源码仓库 / GitHub Repositories</h3>
          <h3 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '14px', textAlign: 'left' }}> 欢迎来仓库提Issue（大到程序崩溃，小到错别字都可以），贡献Pull Requests（代码优化，新增功能，修复bug，教程文档，错别字修复都可以）！</h3>
          <h3 style={{ margin: '0 0 8px 0', color: '#5f5f5f', fontSize: '8px', textAlign: 'left' }}> 请大胆使用AI，因为本项目也基于vibe coding开发</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0 20px 0', textAlign: 'left' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '2px' }}>IDE WORKSPACE:</span>
              <a 
                href="https://github.com/xe10e0Ce20/rop_ide_2nd" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#38bdf8', fontFamily: "'JetBrains Mono', monospace", textDecoration: 'none', background: '#111', padding: '6px 12px', borderRadius: '4px', border: '1px solid #222', display: 'inline-block' }}
              >
                🔗 github.com/xe10e0Ce20/rop_ide_2nd
              </a>
            </div>
            <div style={{ marginTop: '6px' }}>
              <span style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '2px' }}>COMPILER CORE:</span>
              <a 
                href="https://github.com/xe10e0Ce20/rop_compiler_2nd" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#38bdf8', fontFamily: "'JetBrains Mono', monospace", textDecoration: 'none', background: '#111', padding: '6px 12px', borderRadius: '4px', border: '1px solid #222', display: 'inline-block' }}
              >
                🔗 github.com/xe10e0Ce20/rop_compiler_2nd
              </a>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #222', margin: '16px 0' }} />

          {/* Core Features */}
          <h3 style={{ margin: '0 0 12px 0', color: '#00ffb3', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px', textAlign: 'left' }}>⚡ 亮点特性 / Key Features</h3>
          <ul style={{ margin: '0 0 16px 0', paddingLeft: '20px', color: '#ccc', textAlign: 'left' }}>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#fff' }}>双源共存 VFS 机制：</strong> 支持本地缓存与云端同步资产两两共存并同时呈现，互不拦截覆盖，支持自由降级及版本锁定。
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#fff' }}>编译报错：</strong> 编译发生错误时，精准显示行列并高亮在左侧。
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#fff' }}>IDE特性</strong> 支持自动补全，鼠标悬停显示提示（鼠标悬停在一些关键字上显示提示），点击跳转定义（ctrl+点击地址标签可跳转至定义处）。
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#fff' }}>双向响应式二进制追踪：</strong> 深度关联编辑器光标区间与编译器输出的机器十六进制字节流，实时计算并高亮内存映射范围。
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#fff' }}>全功能 PWA 离线运行：</strong> 使用 Service Worker 预缓存，可离线运行。
            </li>
          </ul>

          <hr style={{ border: 'none', borderTop: '1px solid #222', margin: '16px 0' }} />

          {/* Release Notes */}
          <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px', textAlign: 'left' }}>📝 发行说明 / Release Notes</h3>
          <div style={{ marginBottom: '8px', textAlign: 'left' }}>
            <div style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '13px', fontFamily: "'JetBrains Mono', monospace" }}>v0.0.1 (Current)</div>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: '#ccc', textAlign: 'left' }}>
              <li style={{ marginBottom: '4px' }}>Initial Release // 系统初次构建完成。预发行版本。目前程序不稳定，如果遇到字节码不高亮，自动补全不弹出等问题，建议刷新一下页面。</li>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #222', margin: '16px 0' }} />

          {/* Release Notes */}
          <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px', textAlign: 'left' }}>🔨 工具链 / Tool Chain</h3>
          <div style={{ marginBottom: '8px', textAlign: 'left' }}>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: '#ccc', textAlign: 'left' }}>
              <li style={{ marginBottom: '4px' }}>ggt-finder: gadget查找器</li><a href="https://ggt-finder.pages.dev/" style={{ color: '#38bdf8'}}>ggt-finder.pages.dev/</a>
              <li style={{ marginBottom: '4px' }}>disas生成器（基于users的反汇编器开发，用于提供ggt-finder能识别的_disas）</li><a href="https://tieba.baidu.com/p/10780399354" style={{ color: '#38bdf8'}}>贴吧</a>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #222', margin: '16px 0' }} />

          {/* System Status */}
          <h3 style={{ margin: '0 0 8px 0', color: '#aaa', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', textAlign: 'left' }}>BUILD INFORMATION</h3>
          <div style={{ background: '#0d0d0d', padding: '12px', borderRadius: '6px', border: '1px solid #222', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: '#888', textAlign: 'left' }}>
            <div>ENVIRONMENT : PRODUCTION (BUILD_CLIENT)</div>
            <div>WASM TARGET : MULTI_THREAD_ATOMICS_ENABLED</div>
            <div>IDE VERSION : v0.0.1</div>
          </div>

        </div>

        {/* Footer - 按钮左对齐 */}
        <div style={{ padding: '12px 24px', background: '#1a1a1a', borderTop: '1px solid #2d2d2d', display: 'flex', justifyContent: 'flex-start' }}>
          <button 
            type="button" 
            onClick={onClose}
            style={{ background: '#38bdf8', border: 'none', color: '#000', padding: '6px 16px', fontSize: '12px', fontWeight: 'bold', fontFamily: "'JetBrains Mono', monospace", borderRadius: '4px', cursor: 'pointer' }}
          >
            ACKNOWLEDGE
          </button>
        </div>

      </div>
    </div>
  );
}