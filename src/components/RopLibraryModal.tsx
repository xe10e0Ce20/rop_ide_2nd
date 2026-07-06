// src/components/RopLibraryModal.tsx
import { useState } from 'react';
import { saveVFSLib, deleteVFSLib } from '../utils/vfs';
import type { ManagedLib } from '../utils/vfs';

interface RopLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCode: string;
  vfsLibs: ManagedLib[];
  onUpdateVfs: () => void;
  onDirectViewLib: (lib: ManagedLib) => void;
  // 🚀 新增：承接主界面的异步刷新状态与控制句柄
  isRefreshing?: boolean;
  onManualRefresh?: () => void;
}

export default function RopLibraryModal({ 
  isOpen, onClose, currentCode, vfsLibs, onUpdateVfs, onDirectViewLib,
  isRefreshing = false, onManualRefresh
}: RopLibraryModalProps) {
  
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [desc, setDesc] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [isLocalMode, setIsLocalMode] = useState(true); // true: 创建本地库, false: 提交到线上

  if (!isOpen) return null;

  const handleSaveOrPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const targetName = name.trim();
    const targetVersion = version.trim();

    if (!targetName) return alert("名称不能为空");
    if (!targetVersion) return alert("版本号不能为空");

    const existing = vfsLibs.find(l => l.name === targetName);
    
    if (existing && existing.versions[targetVersion]) {
      return alert(
        `库 "${targetName}" 已经存在版本号 v${targetVersion}！`
      );
    }

    if (isLocalMode) {
      // 在本地 VFS 中创建/增量安全追加新版本
      const newVersionObj = { version: targetVersion, code: currentCode, updatedAt: Date.now() };
      
      const updatedLib: ManagedLib = existing 
        ? {
            ...existing,
            description: desc || existing.description,
            activeVersion: targetVersion,
            versions: { ...existing.versions, [targetVersion]: newVersionObj }
          }
        : {
            name: targetName, author: author || "Local", description: desc, isLocal: true,
            activeVersion: targetVersion, versions: { [targetVersion]: newVersionObj }
          };

      await saveVFSLib(updatedLib);
      alert(`本地库 ${targetName} (v${targetVersion}) 保存成功！`);
      onUpdateVfs();
    } else {
      // ☁️ 线上推流逻辑 —— 此时已通过上面的重复版本号强熔断校验
      try {
        const res = await fetch('/api/libs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: targetName, author, description: desc, version: targetVersion, code: currentCode })
        });
        if (res.ok) { 
          alert("云端库发布/更新提议成功！"); 
          onUpdateVfs(); 
        } else {
          alert("服务器拒绝了发布请求。");
        }
      } catch (e) { 
        alert("云端发布失败，请检查网络。"); 
      }
    }
  };

  const handleVersionChange = async (lib: ManagedLib, targetVer: string) => {
    lib.activeVersion = targetVer;
    await saveVFSLib(lib);
    onUpdateVfs();
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ width: '850px', height: '580px', background: '#161616', border: '1px solid #2d2d2d', borderRadius: '8px', display: 'flex', flexDirection: 'column', fontFamily: "'JetBrains Mono', monospace", color: '#e0e0e0' }}>
        
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#00ffb3' }}>// VIRTUAL_FILE_SYSTEM_AND_DEPENDENCY_CONTROL</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#ff5555', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 左侧控制台 */}
          <div style={{ width: '320px', padding: '20px', borderRight: '1px solid #2d2d2d', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '4px', background: '#111', padding: '2px', borderRadius: '4px' }}>
              <button type="button" onClick={() => setIsLocalMode(true)} style={{ flex: 1, background: isLocalMode ? '#222' : 'transparent', border: 'none', color: isLocalMode ? '#00ffb3' : '#666', padding: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>[ 💾 本地自建 ]</button>
              <button type="button" onClick={() => setIsLocalMode(false)} style={{ flex: 1, background: !isLocalMode ? '#222' : 'transparent', border: 'none', color: !isLocalMode ? '#00ffb3' : '#666', padding: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>[ ☁️ 发布上线 ]</button>
            </div>

            <form onSubmit={handleSaveOrPublish} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', borderRadius: '4px' }} placeholder="库模块标识符 (如 std_math)" value={name} onChange={e => setName(e.target.value)} />
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', borderRadius: '4px' }} placeholder="版本号 (如 1.0.2)" value={version} onChange={e => setVersion(e.target.value)} />
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', borderRadius: '4px' }} placeholder="维护者" value={author} onChange={e => setAuthor(e.target.value)} />
              <textarea style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', height: '60px', resize: 'none', borderRadius: '4px' }} placeholder="依赖描述信息..." value={desc} onChange={e => setDesc(e.target.value)} />
              <button type="submit" style={{ background: isLocalMode ? '#00ffb3' : '#38bdf8', color: '#000', border: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                {isLocalMode ? '💾 写入本地 VFS' : '⚡ 广播至云端仓库'}
              </button>
            </form>
          </div>

          {/* 右侧 VFS 资产管理器 */}
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #222', paddingBottom: '6px' }}>
              <div style={{ fontSize: '12px', color: '#888' }}>当前工作区可用文件映像 ({vfsLibs.length})</div>
              {onManualRefresh && (
                <button 
                  type="button"
                  onClick={onManualRefresh}
                  disabled={isRefreshing}
                  style={{ background: '#222', border: '1px solid #333', color: isRefreshing ? '#555' : '#00ffb3', padding: '2px 10px', fontSize: '11px', borderRadius: '4px', cursor: isRefreshing ? 'not-allowed' : 'pointer', fontFamily: "'JetBrains Mono'" }}
                >
                  {isRefreshing ? '🔄 刷新中...' : '🔄 刷新 VFS'}
                </button>
              )}
            </div>
            
            {vfsLibs.map(lib => (
              <div key={lib.name} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: lib.isLocal ? '#ffd700' : '#38bdf8', fontSize: '11px', marginRight: '6px' }}>
                      {lib.isLocal ? '● LOCAL' : '● CACHED'}
                    </span>
                    <strong style={{ color: '#fff', fontSize: '14px' }}>{lib.name}</strong>
                  </div>

                  {/* 锁版本下拉菜单 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#666' }}>锁版本:</span>
                    <select 
                      value={lib.activeVersion} 
                      onChange={(e) => handleVersionChange(lib, e.target.value)}
                      style={{ background: '#222', border: '1px solid #444', color: '#00ffb3', fontSize: '12px', padding: '2px 6px', borderRadius: '4px', fontFamily: "'JetBrains Mono'" }}
                    >
                      {Object.keys(lib.versions).map(v => (
                        <option key={v} value={v}>v{v}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: '#aaa' }}>{lib.description || '无描述声明.'}</div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#555' }}>by {lib.author}</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => onDirectViewLib(lib)} style={{ background: '#222', border: '1px solid #333', color: '#aaa', padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer' }}>📃 查看源码</button>
                    {lib.isLocal && (
                      <button type="button" onClick={async () => { if(confirm(`确定彻底删除本地库 [ ${lib.name} ] 吗？`)) { await deleteVFSLib(lib.name); onUpdateVfs(); } }} style={{ background: 'transparent', border: 'none', color: '#ef4444', padding: '3px 4px', fontSize: '11px', cursor: 'pointer' }}>[删除]</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}