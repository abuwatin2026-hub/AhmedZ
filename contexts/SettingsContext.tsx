import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import type { AppLanguage, AppSettings, AppTheme, PersistedAppSettings } from '../types';
import { getSupabaseClient } from '../supabase';
import { logger } from '../utils/logger';
import { localizeSupabaseError } from '../utils/errorUtils';
import appIconPng from '../resources/icon.png';

// Minimal TranslationKeys type to satisfy the hook signature
type TranslationKeys = string;

type Theme = AppTheme;
export type Language = AppLanguage;

interface SettingsContextType {
  settings: AppSettings;
  updateSettings: (newSettings: AppSettings) => Promise<void>;
  theme: Theme;
  toggleTheme: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return { r, g, b };
};

const rgbToHsl = (r: number, g: number, b: number) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / delta) % 6;
        break;
      case gn:
        h = (bn - rn) / delta + 2;
        break;
      default:
        h = (rn - gn) / delta + 4;
        break;
    }
    h = h * 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hh >= 0 && hh < 1) {
    r1 = c;
    g1 = x;
  } else if (hh >= 1 && hh < 2) {
    r1 = x;
    g1 = c;
  } else if (hh >= 2 && hh < 3) {
    g1 = c;
    b1 = x;
  } else if (hh >= 3 && hh < 4) {
    g1 = x;
    b1 = c;
  } else if (hh >= 4 && hh < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) };
};

const SHADES: Array<[number, number]> = [
  [50, 0.97],
  [100, 0.92],
  [200, 0.84],
  [300, 0.74],
  [400, 0.64],
  [500, 0.50],
  [600, 0.42],
  [700, 0.34],
  [800, 0.26],
  [900, 0.18],
  [950, 0.10],
];

const applyPalette = (paletteName: 'primary' | 'gold' | 'mint', baseHex: string) => {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const root = window.document.documentElement;

  SHADES.forEach(([shade, l]) => {
    const { r, g, b } = hslToRgb(h, s, l);
    root.style.setProperty(`--color-${paletteName}-${shade}`, `${r} ${g} ${b}`);
  });
};

const defaultLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#FFFFFF" stroke="#2F2B7C" stroke-width="6"/><circle cx="50" cy="50" r="34" fill="#FFFFFF" stroke="#2F2B7C" stroke-width="2" opacity="0.9"/><text x="50" y="60" text-anchor="middle" fill="#2F2B7C" font-size="32" font-weight="800" font-family="Inter, Arial, sans-serif">AZT</text></svg>`;
const defaultLogoUrl = `data:image/svg+xml;utf8,${encodeURIComponent(defaultLogoSvg)}`;

const defaultSettings: AppSettings = {
  cafeteriaName: { ar: 'مؤسسة أحمد زنقاح للتجارة والتوكيلات', en: 'Ahmed Zangah Trading & Agencies Est' },
  logoUrl: defaultLogoUrl,
  contactNumber: '967782681999',
  address: 'مأرب، اليمن',
  maintenanceEnabled: false,
  maintenanceMessage: 'التطبيق في وضع الصيانة مؤقتًا. الرجاء المحاولة لاحقًا.',
  brandColors: {
    primary: '#2F2B7C',
    gold: '#B0AEFF',
    mint: '#7E7BFF',
  },
  paymentMethods: {
    cash: true,
    kuraimi: true,
    network: true,
  },
  defaultLanguage: 'ar',
  loyaltySettings: {
    enabled: true,
    pointsPerCurrencyUnit: 0.1, // 1 point for every 10 YER
    currencyValuePerPoint: 1, // 1 point = 1 YER
    tiers: {
      regular: { name: { ar: 'عادي', en: 'Regular' }, threshold: 0, discountPercentage: 0 },
      bronze: { name: { ar: 'البرونزي', en: 'Bronze' }, threshold: 1000, discountPercentage: 2 },
      silver: { name: { ar: 'الفضي', en: 'Silver' }, threshold: 5000, discountPercentage: 5 },
      gold: { name: { ar: 'الذهبي', en: 'Gold' }, threshold: 15000, discountPercentage: 10 },
    },
    referralRewardPoints: 100, // Points for the referrer
    newUserReferralDiscount: {
      type: 'fixed',
      value: 500,
    },
  },
  taxSettings: {
    enabled: false,
    rate: 15,
    taxNumber: '',
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

const mergeSettings = (base: AppSettings, incoming: unknown): AppSettings => {
  if (!isRecord(incoming)) return base;
  const candidate = incoming as Partial<AppSettings>;
  const { deliverySettings: _deliverySettings, ...candidateNoDelivery } = candidate as any;

  const merged: AppSettings = {
    ...base,
    ...(candidateNoDelivery as any),
    cafeteriaName: {
      ...base.cafeteriaName,
      ...(isRecord(candidate.cafeteriaName) ? (candidate.cafeteriaName as any) : {}),
    },
    paymentMethods: {
      ...base.paymentMethods,
      ...(isRecord(candidate.paymentMethods) ? (candidate.paymentMethods as any) : {}),
    },
    loyaltySettings: {
      ...base.loyaltySettings,
      ...(isRecord(candidate.loyaltySettings) ? (candidate.loyaltySettings as any) : {}),
      tiers: {
        ...base.loyaltySettings.tiers,
        ...(isRecord(candidate.loyaltySettings?.tiers) ? (candidate.loyaltySettings?.tiers as any) : {}),
      },
      newUserReferralDiscount: {
        ...base.loyaltySettings.newUserReferralDiscount,
        ...(isRecord(candidate.loyaltySettings?.newUserReferralDiscount)
          ? (candidate.loyaltySettings?.newUserReferralDiscount as any)
          : {}),
      },
    },
    taxSettings: {
      ...base.taxSettings,
      ...(isRecord(candidate.taxSettings) ? (candidate.taxSettings as any) : {}),
    },
  };

  return merged;
};

const setOrCreateLink = (rel: string, attrs: Record<string, string>) => {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([key, value]) => {
    el!.setAttribute(key, value);
  });
};

const toPngDataUrl = (src: string, size: number): Promise<string> => new Promise((resolve, reject) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('no-canvas'));
      return;
    }
    ctx.clearRect(0, 0, size, size);
    const scale = Math.min(size / img.width, size / img.height);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const x = Math.round((size - w) / 2);
    const y = Math.round((size - h) / 2);
    ctx.drawImage(img, x, y, w, h);
    try {
      resolve(canvas.toDataURL('image/png'));
    } catch (e) {
      reject(e);
    }
  };
  img.onerror = () => reject(new Error('img-load-failed'));
  img.src = src;
});

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings);
  const [theme, setTheme] = useState<Theme>('light');

  const fetchRemoteSettings = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data: row, error } = await supabase.from('app_settings').select('id,data').eq('id', 'app').maybeSingle();
    if (error) throw new Error(localizeSupabaseError(error));
    const remote = row?.data as Partial<PersistedAppSettings> | undefined;
    const remoteSettings = remote?.settings;
    if (!remoteSettings) return null;
    const mergedSettings = mergeSettings(defaultSettings, remoteSettings);
    setSettings(mergedSettings);
    return mergedSettings;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Offline: We can't fetch remote settings. Keep defaults or previously loaded.
        console.warn('Offline: Using default settings');
        if (cancelled) return;
        setSettings(defaultSettings);
        return;
      }

      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          const merged = await fetchRemoteSettings();
          if (cancelled) return;
          if (merged) {
            setSettings(merged);
            setTheme('light');
            return;
          }
        } catch (error) {
          logger.error(localizeSupabaseError(error));
          // Do NOT revert to defaults silently if we expected content but failed to fetch it.
          // However, for settings, starting with defaults if DB is empty is acceptable, 
          // but failing to connect should be logged.
        }
      } else {
        logger.warn('Supabase not configured: Using default settings');
      }

      if (cancelled) return;
      setSettings(defaultSettings);
      setTheme('light');
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [fetchRemoteSettings]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const logo = (settings.logoUrl || '').trim();
    const fallback = appIconPng;
    const run = async () => {
      try {
        if (!logo) {
          setOrCreateLink('apple-touch-icon', { href: fallback, sizes: '180x180' });
          return;
        }
        if (logo.startsWith('data:image/png')) {
          setOrCreateLink('apple-touch-icon', { href: logo, sizes: '180x180' });
          return;
        }
        if (!logo.startsWith('data:')) {
          setOrCreateLink('apple-touch-icon', { href: logo, sizes: '180x180' });
          return;
        }
        const png = await toPngDataUrl(logo, 180);
        setOrCreateLink('apple-touch-icon', { href: png, sizes: '180x180' });
      } catch {
        setOrCreateLink('apple-touch-icon', { href: fallback, sizes: '180x180' });
      }
    };
    void run();
  }, [settings.logoUrl]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchRemoteSettings();
    };

    const onFocus = () => scheduleRefetch();
    const onVisibility = () => scheduleRefetch();
    const onOnline = () => scheduleRefetch();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
    }

    const channel = supabase
      .channel('public:app_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'id=eq.app' }, async () => {
        try {
          await fetchRemoteSettings();
        } catch {
        }
      })
      .subscribe();
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', onOnline);
      }
      supabase.removeChannel(channel);
    };
  }, [fetchRemoteSettings]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (!settings.brandColors) return;
    applyPalette('primary', settings.brandColors.primary);
    applyPalette('gold', settings.brandColors.gold);
    applyPalette('mint', settings.brandColors.mint);
  }, [settings.brandColors]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  useEffect(() => {
    const root = window.document.documentElement;
    root.lang = 'ar';
    root.dir = 'rtl';
  }, []);

  const updateSettings = async (newSettings: AppSettings) => {
    const merged = mergeSettings(defaultSettings, newSettings);
    setSettings(merged);
    const record: PersistedAppSettings = {
      id: 'app',
      settings: merged,
      theme,
      customerLanguage: 'ar',
      adminLanguage: 'ar',
      updatedAt: new Date().toISOString(),
    };
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase
          .from('app_settings')
          .upsert({ id: record.id, data: { id: 'app', settings: record.settings, updatedAt: record.updatedAt } }, { onConflict: 'id' });
      } catch (error) {
        logger.error(localizeSupabaseError(error));
      }
    }
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, theme, toggleTheme }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }

  // Always force Arabic
  const language: AppLanguage = 'ar';

  const toggleLanguage = () => {
    // Disabled language toggling - enforcing Arabic
  };

  const t = (key: TranslationKeys | string, _options?: Record<string, string | number>) => key;

  return {
    settings: context.settings,
    updateSettings: context.updateSettings,
    theme: context.theme,
    toggleTheme: context.toggleTheme,
    language,
    toggleLanguage,
    t,
  };
};
