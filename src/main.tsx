import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';
import './index.css';
import App from './App.tsx';
import AppMobile from './AppMobile.tsx';

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

// 根据屏幕宽度判断是否使用移动端布局
const isMobile = () => window.innerWidth <= 768;

const AppWrapper = () => {
  const [isMobileView, setIsMobileView] = React.useState(isMobile());

  React.useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobileView ? <AppMobile /> : <App />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWrapper />
  </StrictMode>,
);
