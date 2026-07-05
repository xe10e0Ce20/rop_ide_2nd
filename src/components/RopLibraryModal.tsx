import { useState, useEffect, useCallback, useRef } from 'react';

interface LibItem {
  name: string;
  author: string;
  description: string;
  code: string;
  updatedAt: number;
}

interface RopLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCode: string;
  onImportCode: (code: string) => void;
  onRefreshLibs?: (libs: LibItem[]) => void;
  onDirectViewLib?: (lib: LibItem) => void; // <-- 确保加上这一行
}

export default function RopLibraryModal({ 
  isOpen, 
  onClose, 
  currentCode, 
  onImportCode, 
  onRefreshLibs,
  onDirectViewLib // 接收新增回调
}: RopLibraryModalProps) {
  const [libs, setLibs] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [desc, setDesc] = useState('');

  const refreshCallbackRef = useRef(onRefreshLibs);
  
  useEffect(() => {
    refreshCallbackRef.current = onRefreshLibs;
  }, [onRefreshLibs]);

  const fetchLibs = useCallback(async (isMounted: boolean) => {
    if (!isMounted) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/libs');
      const data = await res.json();
      if (Array.isArray(data) && isMounted) {
        setLibs(data);
        if (refreshCallbackRef.current) refreshCallbackRef.current(data);
      }
    } catch (e) {
      console.error("加载公共库失败", e);
    } finally {
      if (isMounted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (isOpen) {
      Promise.resolve().then(() => {
        if (isMounted) fetchLibs(isMounted);
      });
    }
    return () => { isMounted = false; };
  }, [isOpen, fetchLibs]);

  if (!isOpen) return null;

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return alert("请输入库文件名称");
    
    try {
      const res = await fetch('/api/libs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, author, description: desc, code: currentCode })
      });
      if (res.ok) {
        alert("发布/更新成功！");
        setName(''); setDesc('');
        fetchLibs(true);
      }
    } catch (e) {
      alert("发布失败");
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ width: '750px', height: '550px', background: '#161616', border: '1px solid #2d2d2d', borderRadius: '8px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', fontFamily: "'JetBrains Mono', monospace", color: '#e0e0e0' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#00ffb3' }}>// GLOBAL_ROP_LIBRARY_CENTRAL_SYSTEM</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#ff5555', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>
        
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 左侧上传表单 */}
          <div style={{ width: '300px', padding: '20px', borderRight: '1px solid #2d2d2d', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '12px', color: '#666' }}>[将当前代码上架到云端库]</div>
            <form onSubmit={handlePublish} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '6px 10px', fontSize: '12px', borderRadius: '4px' }} placeholder="库名称" value={name} onChange={e => setName(e.target.value)} />
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '6px 10px', fontSize: '12px', borderRadius: '4px' }} placeholder="贡献者" value={author} onChange={e => setAuthor(e.target.value)} />
              <textarea style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '6px 10px', fontSize: '12px', height: '80px', resize: 'none', borderRadius: '4px' }} placeholder="说明..." value={desc} onChange={e => setDesc(e.target.value)} />
              <button type="submit" style={{ background: '#00ffb3', color: '#000', border: 'none', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>Push to Cloud</button>
            </form>
          </div>

          {/* 右侧列表 */}
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#888' }}>云端共享资产 ({libs.length})</span>
              <button type="button" onClick={() => fetchLibs(true)} style={{ background: 'none', border: 'none', color: '#00ffb3', cursor: 'pointer', fontSize: '11px' }}>[FORCE_SYNC]</button>
            </div>
            
            {loading ? <div style={{ color: '#555', fontSize: '12px' }}>正在同步多维数据...</div> : 
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {libs.map(lib => (
                  <div key={lib.name} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '13px' }}>@{lib.name}</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {/* 预览按钮 */}
                        <button type="button" onClick={() => onDirectViewLib?.(lib)} style={{ background: '#222', border: '1px solid #444', color: '#00ffb3', padding: '2px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '3px' }}>View</button>
                        {/* 导入按钮 */}
                        <button type="button" onClick={() => { if(confirm(`覆盖当前编辑区？/Overwrite the current editing area?`)) { onImportCode(lib.code); onClose(); } }} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ffaa00', padding: '2px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '3px' }}>Import & Overwrite</button>
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: '#555' }}>Author: {lib.author}</div>
                    <div style={{ fontSize: '12px', color: '#aaa', background: '#151515', padding: '6px 10px', borderRadius: '4px', marginTop: '6px' }}>{lib.description}</div>
                  </div>
                ))}
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}