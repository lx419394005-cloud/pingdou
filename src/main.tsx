import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

const blockBrowserZoom = () => {
  const shouldBlockZoomKey = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return false;
    }

    return event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_' || event.key === '0';
  };

  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (shouldBlockZoomKey(event)) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  // Safari trackpad pinch gestures.
  window.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
  window.addEventListener('gesturechange', (event) => event.preventDefault(), { passive: false });
};

blockBrowserZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
