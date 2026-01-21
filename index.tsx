import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { AppProviders } from '@/contexts/AppProviders';

const ensureFreshApp = async () => {
  if (import.meta.env.DEV) return;
  const safeGet = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const safeSet = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  const stored = safeGet('caty_app_version');
  const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);
  const response = await fetch(url, { cache: 'no-store', signal: controller.signal }).catch(() => null);
  window.clearTimeout(timeoutId);
  if (!response || !response.ok) return;
  const data = (await response.json().catch(() => null)) as null | { version?: string; versionCode?: number };
  if (!data?.version && data?.versionCode == null) return;

  const next = String(data.versionCode ?? data.version ?? '');
  if (!next) return;
  if (stored && stored === next) return;
  if (!safeSet('caty_app_version', next)) return;

  const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const hasCaches = typeof caches !== 'undefined';
  const hasActiveController = hasSw && !!navigator.serviceWorker.controller;
  const hasAnyRegistration = async () => {
    if (!hasSw) return false;
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    return regs.length > 0;
  };
  const hasAnyCache = async () => {
    if (!hasCaches) return false;
    const keys = await caches.keys().catch(() => []);
    return keys.length > 0;
  };
  const unregisterAll = async () => {
    if (!hasSw) return;
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(regs.map(reg => reg.unregister().catch(() => false)));
  };
  const clearAllCaches = async () => {
    if (!hasCaches) return;
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map(key => caches.delete(key).catch(() => false)));
  };

  const shouldReload = hasActiveController || (await hasAnyRegistration()) || (await hasAnyCache());
  if (!shouldReload) return;

  await unregisterAll();
  await clearAllCaches();
  window.location.reload();
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const Boot: React.FC = () => {
  const [ready, setReady] = useState(import.meta.env.DEV);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    const run = async () => {
      await ensureFreshApp();
      if (!cancelled) setReady(true);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-700 dark:text-gray-200">
        جاري تحميل التطبيق...
      </div>
    );
  }

  return (
    <AppProviders>
      <App />
    </AppProviders>
  );
};

root.render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>
);
