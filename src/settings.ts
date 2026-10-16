import { useSyncExternalStore } from 'react';

export interface Settings {
  hour12: boolean;
  coordFormat: 'decimal' | 'dms';
  showInfoCard: boolean;
  /** مظهر القمر أثناء الخسوف: 'auto' أو معرّف أحد المظاهر في core/danjon.ts */
  eclipseLook: string;
}

export const DEFAULT_SETTINGS: Settings = { hour12: false, coordFormat: 'decimal', showInfoCard: true, eclipseLook: 'auto' };
const KEY = 'astro.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* تجاهل */
  }
  return DEFAULT_SETTINGS;
}

let current: Settings = typeof window === 'undefined' ? DEFAULT_SETTINGS : load();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }; // كائن جديد في كل تغيير ليعمل useSyncExternalStore
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* تجاهل */
  }
  listeners.forEach((l) => l());
}
/** قراءة فورية خارج React (للرسم على الكانفاس) */
export const getSettings = (): Settings => current;
export const resetSettings = () => updateSettings(DEFAULT_SETTINGS);

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_SETTINGS);
}

/** تنسيق إحداثي: عشري 36.8065° أو 36°48′23″ */
export function formatCoord(value: number, pos: string, neg: string, format: Settings['coordFormat']): string {
  const a = Math.abs(value);
  const letter = value >= 0 ? pos : neg;
  if (format === 'decimal') return `${a.toFixed(4)}° ${letter}`;
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const sec = Math.round((mFloat - m) * 60);
  const carry = sec === 60;
  return `${d}°${String(carry ? m + 1 : m).padStart(2, '0')}′${String(carry ? 0 : sec).padStart(2, '0')}″ ${letter}`;
}
