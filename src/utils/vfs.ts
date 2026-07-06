// src/utils/vfs.ts

// 依赖库包数据结构
export interface LibVersion {
  version: string;
  code: string;
  updatedAt: number;
}
export interface ManagedLib {
  name: string;
  author: string;
  description: string;
  isLocal: boolean;
  activeVersion: string;
  versions: Record<string, LibVersion>;
}

export interface SnippetVersion {
  version: string;
  code: string;
  updatedAt: number;
}
export interface PublicSnippet {
  title: string;       // 标识符/标题
  author: string;      // 署名维护者
  description: string; // 描述说明
  isLocal: boolean;    // 是否是本地自建
  activeVersion: string; // 当前锁定的版本游标
  versions: Record<string, SnippetVersion>; // 版本全家桶
}

// ==========================================
// 依赖库底层存储 API
// ==========================================
export async function getAllVFSLibs(): Promise<ManagedLib[]> {
  const data = localStorage.getItem('vfs_managed_libs');
  return data ? JSON.parse(data) : [];
}
export async function saveVFSLib(lib: ManagedLib): Promise<void> {
  const list = await getAllVFSLibs();
  const idx = list.findIndex(l => l.name === lib.name);
  if (idx > -1) list[idx] = lib; else list.push(lib);
  localStorage.setItem('vfs_managed_libs', JSON.stringify(list));
}
export async function deleteVFSLib(name: string): Promise<void> {
  const list = await getAllVFSLibs();
  localStorage.setItem('vfs_managed_libs', JSON.stringify(list.filter(l => l.name !== name)));
}

export async function getAllPublicSnippets(): Promise<PublicSnippet[]> {
  const data = localStorage.getItem('vfs_public_snippets_v2'); // 升级 v2 隔离老数据
  return data ? JSON.parse(data) : [];
}

export async function savePublicSnippet(snippet: PublicSnippet): Promise<void> {
  const list = await getAllPublicSnippets();
  const idx = list.findIndex(s => s.title === snippet.title);
  if (idx > -1) list[idx] = snippet; else list.push(snippet);
  localStorage.setItem('vfs_public_snippets_v2', JSON.stringify(list));
}

export async function deletePublicSnippet(title: string): Promise<void> {
  const list = await getAllPublicSnippets();
  localStorage.setItem('vfs_public_snippets_v2', JSON.stringify(list.filter(s => s.title !== title)));
}