import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useApp } from './store';
import './styles.css';

// Debug hook (read-only inspection from the console / automated tests)
(window as unknown as { __signal911: typeof useApp }).__signal911 = useApp;

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
