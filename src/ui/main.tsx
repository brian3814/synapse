import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if ((window as any).electronAPI) {
  const { installChromeStubs } = await import('../platform/install-chrome-stubs');
  installChromeStubs();
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
