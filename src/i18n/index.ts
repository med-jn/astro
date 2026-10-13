import { useCallback, useSyncExternalStore } from 'react';
import { ar, type Dict } from './ar';
import { en, SPEEDS_EN } from './en';

export type Lang = 'ar' | 'en';
export type TKey = keyof Dict;

const STORAGE_KEY = 'astro.lang';
const dicts: Record<Lang, Dict> = { ar, en };

/** أرقام لاتينية دائماً في العربية أيضاً، لتناسق القراءة العلمية. */
const LOCALES: Record<Lang, { date: string; hijri: string }> = {
  ar: { date: 'ar-u-nu-latn-ca-gregory', hijri: 'ar-u-ca-islamic-umalqura-nu-latn' },
  en: { date: 'en-GB', hijri: 'en-u-ca-islamic-umalqura' },
};

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* التخزين غير متاح */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

let current: Lang = typeof window === 'undefined' ? 'ar' : detect();
const listeners = new Set<() => void>();

function applyToDocument(lang: Lang) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.lang = lang;
  el.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
applyToDocument(current);

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* تجاهل */
  }
  applyToDocument(lang);
  listeners.forEach((l) => l());
}

export function translate(lang: Lang, key: TKey, params?: Record<string, string | number>): string {
  let s: string = dicts[lang][key] ?? dicts.ar[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const getSnapshot = () => current;

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, () => 'ar' as Lang);
  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang],
  );
  return {
    lang,
    dir: lang === 'ar' ? ('rtl' as const) : ('ltr' as const),
    locale: LOCALES[lang],
    t,
    setLang,
    /** تسمية السرعة: العربية من الـ store، والإنجليزية من SPEEDS_EN إن مُلئت. */
    speedLabel: (arLabels: readonly string[], i: number) =>
      lang === 'en' && SPEEDS_EN[i] ? SPEEDS_EN[i] : arLabels[i],
  };
}

/* ---------- تنسيقات مشتركة ---------- */
const pad = (n: number) => String(n).padStart(2, '0');

export const fmtClock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const fmtClockShort = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDateLong = (d: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
export const fmtDateTime = (d: Date, locale: string) => `${fmtDateLong(d, locale)} · ${fmtClockShort(d)}`;
export const monthName = (d: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: 'long' }).format(d);
export const toInputValue = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export function hoursToHMS(h: number): string {
  const total = Math.round((((h % 24) + 24) % 24) * 3600);
  return `${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
export const fmtDeg = (v: number, digits = 1) => `${v.toFixed(digits)}°`;
