// src/components/RopLibraryModal.tsx
import { useState } from 'react';
import { saveVFSLib, deleteVFSLib, savePublicSnippet, deletePublicSnippet } from '../utils/vfs';
import type { ManagedLib, PublicSnippet } from '../utils/vfs';

interface RopLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCode: string; // 当前工作区的代码
  vfsLibs: ManagedLib[];
  publicSnippets: PublicSnippet[]; 
  onUpdateVfs: () => void;
  onDirectViewLib: (lib: ManagedLib) => void;
  onOverwriteWorkarea: (code: string) => void;
  isRefreshing?: boolean;
  onManualRefresh?: () => void;
}

export default function RopLibraryModal({ 
  isOpen, onClose, currentCode, vfsLibs, publicSnippets, onUpdateVfs, onDirectViewLib, onOverwriteWorkarea,
  isRefreshing = false, onManualRefresh
}: RopLibraryModalProps) {
  
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [desc, setDesc] = useState('');
  const [version, setVersion] = useState('1.0.0');
  
  const [assetType, setAssetType] = useState<'package' | 'snippet'>('package'); 
  const [isLocalMode, setIsLocalMode] = useState(true); 

  if (!isOpen) return null;

  // 1. 一键复制代码到剪贴板
  const handleCopyToClipboard = (code: string, label: string) => {
    if (!code) return alert("无可复制的代码内容");
    navigator.clipboard.writeText(code)
      .then(() => alert(`📋 [${label}] 代码已成功复制到剪贴板！`))
      .catch(err => console.error("复制失败:", err));
  };

  // 2. 核心功能：将云端库/代码片段缓存至本地VFS（实现同名共存）
  const handleCacheToLocal = async (sourceAsset: any, type: 'package' | 'snippet') => {
    const activeVersion = sourceAsset.activeVersion;
    const versionData = sourceAsset.versions[activeVersion];
    
    if (!versionData) return alert("无法获取该资产当前版本的源码，缓存失败。");

    if (type === 'package') {
      // 检查本地 VFS 是否存在绝对同名的原生本地库
      let targetName = sourceAsset.name;
      const hasConflict = vfsLibs.some(l => l.name === targetName && l.isLocal);
      
      if (hasConflict) {
        // 如果名字冲突，采用重命名 Namespace 策略实现完美共存
        targetName = `${sourceAsset.name}_cloud_cached`;
        alert(`提示：由于本地已存在原生的 "${sourceAsset.name}" 库，云端缓存将重命名为 "${targetName}" 以防冲突共存。`);
      }

      const cachedLib: ManagedLib = {
        name: targetName,
        author: sourceAsset.author || "Cloud",
        description: `[云端离线缓存] ${sourceAsset.description || ''}`,
        isLocal: true, // 写入本地 VFS
        activeVersion: activeVersion,
        versions: {
          [activeVersion]: {
            version: activeVersion,
            code: versionData.code,
            updatedAt: Date.now()
          }
        }
      };

      await saveVFSLib(cachedLib);
      alert(`📥 依赖库 [${targetName}] v${activeVersion} 已成功持久化至本地离线 VFS！`);
    } else {
      let targetTitle = sourceAsset.title;
      const hasConflict = publicSnippets.some(s => s.title === targetTitle && s.isLocal);
      
      if (hasConflict) {
        targetTitle = `${sourceAsset.title}_cloud_cached`;
        alert(`提示：由于本地已存在原生代码片段 [${sourceAsset.title}]，云端快照将重命名为 [${targetTitle}] 以防冲突共存。`);
      }

      const cachedSnippet: PublicSnippet = {
        title: targetTitle,
        author: sourceAsset.author || "Cloud",
        description: `[云端离线缓存] ${sourceAsset.description || ''}`,
        isLocal: true, // 标记为本地工作区资产
        activeVersion: activeVersion,
        versions: {
          [activeVersion]: {
            version: activeVersion,
            code: versionData.code,
            updatedAt: Date.now()
          }
        }
      };

      await savePublicSnippet(cachedSnippet);
      alert(`📥 代码片段 [${targetTitle}] v${activeVersion} 已成功克隆至本地代码仓！`);
    }
    onUpdateVfs(); // 触发 VFS 视图重载
  };

  const handleSaveOrPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetName = name.trim();
    const targetVersion = version.trim();

    if (!targetName) return alert("标识符/标题不能为空");
    if (!targetVersion) return alert("版本号不能为空");

    if (assetType === 'package') {
      const existing = vfsLibs.find(l => l.name === targetName);
      if (existing && existing.versions[targetVersion]) {
        return alert(`依赖库 "${targetName}" 已存在版本号 v${targetVersion}，禁止覆盖。`);
      }

      if (isLocalMode) {
        const newVersionObj = { version: targetVersion, code: currentCode, updatedAt: Date.now() };
        const updatedLib: ManagedLib = existing 
          ? { ...existing, description: desc || existing.description, activeVersion: targetVersion, versions: { ...existing.versions, [targetVersion]: newVersionObj } }
          : { name: targetName, author: author || "Local", description: desc, isLocal: true, activeVersion: targetVersion, versions: { [targetVersion]: newVersionObj } };
        
        await saveVFSLib(updatedLib);
        alert(`本地库 ${targetName} (v${targetVersion}) 保存成功！`);
        onUpdateVfs();
      } else {
        try {
          console.log("🚀 发起请求:", { targetName, targetVersion });
          const res = await fetch('/api/libs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: targetName, author, description: desc, version: targetVersion, code: currentCode })
          });

          const responseText = await res.text();
          if (res.status >= 200 && res.status < 300) {
            alert(`🎉 云端发布成功！响应: ${responseText.substring(0, 50)}`);
            onUpdateVfs();
          } else {
            alert(`❌ 后端报错 [${res.status}]: ${responseText}`);
          }
        } catch (err) {
          console.error("网络链路故障:", err);
          alert("🚨 网络链路断裂，请检查控制台 Network 选项卡。");
        }
      }
    } 

    else {
      const existing = publicSnippets.find(s => s.title === targetName);
      if (existing && existing.versions[targetVersion]) {
        return alert(`代码片段 [${targetName}] 已经锁定了版本号 v${targetVersion}`);
      }

      if (isLocalMode) {
        const newVersionObj = { version: targetVersion, code: currentCode, updatedAt: Date.now() };
        const updatedSnippet: PublicSnippet = existing
          ? { ...existing, description: desc || existing.description, activeVersion: targetVersion, versions: { ...existing.versions, [targetVersion]: newVersionObj } }
          : { title: targetName, author: author || "Local", description: desc, isLocal: true, activeVersion: targetVersion, versions: { [targetVersion]: newVersionObj } };

        await savePublicSnippet(updatedSnippet);
        alert(`代码片段 ${targetName} (v${targetVersion}) 成功进入本地工作区！`);
        onUpdateVfs();
      } else {
        try {
          console.log("🚀 开始分发代码片段到云端广场...", { targetName, targetVersion });
          const res = await fetch('/api/snippets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: targetName, author, description: desc, version: targetVersion, code: currentCode })
          });
          
          if (res.ok) { 
            alert(`🎉 代码片段 [${targetName}] (v${targetVersion}) 成功广播发送至云端广场！`); 
            onUpdateVfs(); 
          } else {
            const errText = await res.text().catch(() => "无法读取错误流");
            alert(`❌ 云端网关拒绝了代码分发提议 [HTTP ${res.status}]\n后端反馈: ${errText}`);
          }
        } catch (err: any) { 
          console.error("代码片段分发底层错误:", err);
          alert(`🚨 分发失败！请确认后端终结点是否就绪。\n错误信息: ${err?.message || err}`); 
        }
      }
    }
  };

  const handleLibVersionChange = async (lib: ManagedLib, targetVer: string) => {
    lib.activeVersion = targetVer;
    await saveVFSLib(lib);
    onUpdateVfs();
  };

  const handleSnippetVersionChange = async (snippet: PublicSnippet, targetVer: string) => {
    snippet.activeVersion = targetVer;
    await savePublicSnippet(snippet);
    onUpdateVfs();
  };

  const triggerImportSnippet = (snippet: PublicSnippet) => {
    const activeVerData = snippet.versions[snippet.activeVersion];
    if (!activeVerData) return alert("当前选择的版本快照数据损坏或为空");

    const message = `这会将 [${snippet.title}] v${snippet.activeVersion} 覆盖您的工作区内容，确定要继续吗？`;
    if (confirm(message)) {
      onOverwriteWorkarea(activeVerData.code);
      onClose(); 
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ width: '920px', height: '620px', background: '#161616', border: '1px solid #2d2d2d', borderRadius: '8px', display: 'flex', flexDirection: 'column', fontFamily: "'JetBrains Mono', monospace", color: '#e0e0e0' }}>
        
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#00ffb3' }}>// VFS_ASSET_AND_CODE_REPOS_CONTROLLER</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#ff5555', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>

        {/* 顶部大类切换 */}
        <div style={{ display: 'flex', background: '#111', borderBottom: '1px solid #2d2d2d', padding: '0 20px' }}>
          <button onClick={() => setAssetType('package')} style={{ background: 'none', border: 'none', borderBottom: assetType === 'package' ? '2px solid #00ffb3' : '2px solid transparent', color: assetType === 'package' ? '#00ffb3' : '#777', padding: '12px 20px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>📦 依赖库 (Packages/Imports)</button>
          <button onClick={() => setAssetType('snippet')} style={{ background: 'none', border: 'none', borderBottom: assetType === 'snippet' ? '2px solid #38bdf8' : '2px solid transparent', color: assetType === 'snippet' ? '#38bdf8' : '#777', padding: '12px 20px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>📄 公开代码 (Standalone Snippets)</button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 左侧表单 */}
          <div style={{ width: '340px', padding: '20px', borderRight: '1px solid #2d2d2d', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '4px', background: '#111', padding: '2px', borderRadius: '4px' }}>
              <button type="button" onClick={() => setIsLocalMode(true)} style={{ flex: 1, background: isLocalMode ? '#222' : 'transparent', border: 'none', color: isLocalMode ? '#00ffb3' : '#666', padding: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>[ 💾 本地存储 ]</button>
              <button type="button" onClick={() => setIsLocalMode(false)} style={{ flex: 1, background: !isLocalMode ? '#222' : 'transparent', border: 'none', color: !isLocalMode ? '#00ffb3' : '#666', padding: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>[ ☁️ 分发上传 ]</button>
            </div>

            <form onSubmit={handleSaveOrPublish} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', borderRadius: '4px' }} placeholder={assetType === 'package' ? "库名称" : "代码标题"} value={name} onChange={e => setName(e.target.value)} />
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', borderRadius: '4px' }} placeholder="版本号 (如 1.0.0)" value={version} onChange={e => setVersion(e.target.value)} />
              <input style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', borderRadius: '4px' }} placeholder="署名维护者" value={author} onChange={e => setAuthor(e.target.value)} />
              <textarea style={{ background: '#111', border: '1px solid #333', color: '#fff', padding: '8px', fontSize: '12px', height: '80px', resize: 'none', borderRadius: '4px' }} placeholder="简短补充说明..." value={desc} onChange={e => setDesc(e.target.value)} />
              
              <button type="submit" style={{ background: assetType === 'package' ? (isLocalMode ? '#00ffb3' : '#00e1d9') : (isLocalMode ? '#38bdf8' : '#a855f7'), color: '#000', border: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                {isLocalMode ? `💾 写入本地 VFS (${assetType})` : `⚡ 广播发至云端仓库 (${assetType})`}
              </button>
            </form>
          </div>

          {/* 右侧列表区域 */}
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #222', paddingBottom: '6px' }}>
              <div style={{ fontSize: '12px', color: '#888' }}>
                当前视图：{assetType === 'package' ? `可用文件映像 (${vfsLibs.length}) 注：强烈建议先将要用的库缓存至本地！` : `内部独立代码快照 (${publicSnippets.length})`}
              </div>
              {onManualRefresh && (
                <button type="button" onClick={onManualRefresh} disabled={isRefreshing} style={{ background: '#222', border: '1px solid #333', color: isRefreshing ? '#555' : '#00ffb3', padding: '2px 10px', fontSize: '11px', borderRadius: '4px', cursor: isRefreshing ? 'not-allowed' : 'pointer' }}>
                  {isRefreshing ? '🔄 重载中...' : '🔄 局部重载 VFS'}
                </button>
              )}
            </div>
            
            {/* 依赖库渲染轴 */}
            {assetType === 'package' && vfsLibs.map(lib => (
              <div key={`${lib.name}@${lib.isLocal ? 'local' : 'cloud'}`} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: lib.isLocal ? '#ffd700' : '#38bdf8', fontSize: '11px', marginRight: '6px' }}>{lib.isLocal ? '● LOCAL_LIB' : '● CACHED_LIB'}</span>
                    <strong style={{ color: '#fff', fontSize: '14px' }}>{lib.name}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#666' }}>锁版本:</span>
                    <select value={lib.activeVersion} onChange={(e) => handleLibVersionChange(lib, e.target.value)} style={{ background: '#222', border: '1px solid #444', color: '#00ffb3', fontSize: '12px', padding: '2px 6px', borderRadius: '4px', fontFamily: "'JetBrains Mono'" }}>
                      {Object.keys(lib.versions).map(v => <option key={v} value={v}>v{v}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#aaa' }}>{lib.description || '无描述声明.'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#555' }}>by {lib.author}</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => handleCopyToClipboard(lib.versions[lib.activeVersion]?.code || '', lib.name)} style={{ background: '#222', border: '1px solid #333', color: '#e0e0e0', padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer' }}>📋 复制代码</button>
                    <button type="button" onClick={() => onDirectViewLib(lib)} style={{ background: '#222', border: '1px solid #333', color: '#aaa', padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer' }}>📃 查看源码</button>
                    
                    {/* 如果是云端库，提供一键缓存到本地选项，且不影响原有任何功能 */}
                    {!lib.isLocal && (
                      <button type="button" onClick={() => handleCacheToLocal(lib, 'package')} style={{ background: '#222', border: '1px solid #22d3ee', color: '#22d3ee', padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📥 缓存至本地</button>
                    )}
                    
                    {lib.isLocal && (
                      <button type="button" onClick={async () => { if(confirm(`确定删除依赖库 [ ${lib.name} ] ？`)) { await deleteVFSLib(lib.name); onUpdateVfs(); } }} style={{ background: 'transparent', border: 'none', color: '#ef4444', padding: '3px 4px', fontSize: '11px', cursor: 'pointer' }}>[删除]</button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {assetType === 'snippet' && publicSnippets.map(snippet => (
              <div key={`${snippet.title}@${snippet.isLocal ? 'local' : 'cloud'}`} style={{ background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: snippet.isLocal ? '#ffd700' : '#a855f7', fontSize: '11px', marginRight: '6px', fontWeight: 'bold' }}>
                      {snippet.isLocal ? '● LOCAL_SNIPPET' : '● CLOUD_SNIPPET'}
                    </span>
                    <strong style={{ color: '#fff', fontSize: '14px' }}>{snippet.title}</strong>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#666' }}>选择快照:</span>
                    <select value={snippet.activeVersion} onChange={(e) => handleSnippetVersionChange(snippet, e.target.value)} style={{ background: '#222', border: '1px solid #444', color: '#38bdf8', fontSize: '12px', padding: '2px 6px', borderRadius: '4px', fontFamily: "'JetBrains Mono'" }}>
                      {Object.keys(snippet.versions).map(v => <option key={v} value={v}>v{v}</option>)}
                    </select>
                  </div>
                </div>
                
                <div style={{ fontSize: '12px', color: '#aaa' }}>{snippet.description || '此代码资产无说明描述。'}</div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#555' }}>by {snippet.author}</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => handleCopyToClipboard(snippet.versions[snippet.activeVersion]?.code || '', snippet.title)} style={{ background: '#222', border: '1px solid #333', color: '#e0e0e0', padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer' }}>📋 复制代码</button>
                    <button type="button" onClick={() => triggerImportSnippet(snippet)} style={{ background: '#222', border: '1px solid #333', color: '#00ffb3', padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>⚡ 载入并覆写当前工作区</button>
                    
                    {/* 如果是云端快照，提供同步缓存至本地持久层选项 */}
                    {!snippet.isLocal && (
                      <button type="button" onClick={() => handleCacheToLocal(snippet, 'snippet')} style={{ background: '#222', border: '1px solid #c084fc', color: '#c084fc', padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📥 缓存至本地</button>
                    )}

                    {snippet.isLocal ? (
                      <button type="button" onClick={async () => { if(confirm(`确定从工作区彻底注销公开代码 [ ${snippet.title} ] ？`)) { await deletePublicSnippet(snippet.title); onUpdateVfs(); } }} style={{ background: 'transparent', border: 'none', color: '#ef4444', padding: '3px 4px', fontSize: '11px', cursor: 'pointer' }}>[删除]</button>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#444', padding: '3px 4px' }}>[云端只读]</span>
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