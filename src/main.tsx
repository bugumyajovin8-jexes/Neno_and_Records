import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {installViewportHeight} from './lib/viewport';

// Runs for the life of the app, not per-render, so the shell height tracks the
// soft keyboard even while React is remounting under StrictMode.
installViewportHeight();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
