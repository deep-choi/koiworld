
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

import { AuthProvider } from './contexts/AuthContext';
import { initAnalytics } from './services/analytics';
import { isMonetizationMock } from './config/monetizationMock';
import { MockPreviewRoot } from './components/mock/MockPreviewRoot';

initAnalytics();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const game = (
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

const root = createRoot(rootElement);
// 로컬 미리보기(npm run dev:mock)에서만 휴대폰 기기 테두리와 바깥 도구 패널로 감쌉니다.
// 배포 빌드에서는 isMonetizationMock이 항상 false라 게임만 그리고, 미리보기 코드는 빌드에서 빠집니다.
root.render(isMonetizationMock ? <MockPreviewRoot game={game} /> : game);
