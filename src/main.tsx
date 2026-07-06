import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './fonts.css';
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 确保浏览器支持 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 这里的路径 '/sw.js' 必须相对于你的站点根目录
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('// VFS_PWA: Service Worker 注册成功！作用域为: ', registration.scope);
      })
      .catch((error) => {
        console.error('// VFS_PWA: Service Worker 注册失败: ', error);
      });
  });
}