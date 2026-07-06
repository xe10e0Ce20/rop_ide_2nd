// src/utils/vfs.ts

export interface LibVersion {
  version: string;
  code: string;
  updatedAt: number;
}

export interface ManagedLib {
  name: string;
  author: string;
  description: string;
  isLocal: boolean;       // true: 本地自建库, false: 缓存的线上公共库
  activeVersion: string;  // 当前选择的版本（例如 "1.0.0"）
  versions: Record<string, LibVersion>; // 核心：快照哈希表
}

const DB_NAME = 'ROP_VFS_DATABASE';
const DB_VERSION = 1;
const STORE_NAME = 'libraries';

export function initVFS(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
  });
}

export async function getAllVFSLibs(): Promise<ManagedLib[]> {
  const db = await initVFS();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveVFSLib(lib: ManagedLib): Promise<void> {
  const db = await initVFS();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(lib);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteVFSLib(name: string): Promise<void> {
  const db = await initVFS();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}