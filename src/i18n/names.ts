import type { Lang } from './index';

/** أسماء منازل القمر الثمانية والعشرين بالحروف اللاتينية — بالترتيب نفسه الذي تعرضه الواجهة (index 0 = الشرطان). */
export const MANSIONS_EN = [
  'Al-Sharatan', 'Al-Butayn', 'Ath-Thurayya', 'Ad-Dabaran', "Al-Haq'ah", "Al-Han'ah", "Adh-Dhira'",
  'An-Nathrah', 'At-Tarf', 'Al-Jabhah', 'Az-Zubrah', 'As-Sarfah', "Al-'Awwa'", 'As-Simak',
  'Al-Ghafr', 'Az-Zubana', 'Al-Iklil', 'Al-Qalb', 'Ash-Shawlah', "An-Na'a'im", 'Al-Baldah',
  "Sa'd adh-Dhabih", "Sa'd Bula'", "Sa'd as-Su'ud", "Sa'd al-Akhbiyah", 'Al-Fargh al-Muqaddam',
  "Al-Fargh al-Mu'akhkhar", 'Batn al-Hut',
];

export function mansionName(m: { index: number; nameAr: string }, lang: Lang): string {
  return lang === 'en' ? MANSIONS_EN[m.index] ?? m.nameAr : m.nameAr;
}

const ZODIAC_EN: Record<string, string> = {
  aries: 'Aries', taurus: 'Taurus', gemini: 'Gemini', cancer: 'Cancer', leo: 'Leo', virgo: 'Virgo',
  libra: 'Libra', scorpio: 'Scorpio', scorpius: 'Scorpio', sagittarius: 'Sagittarius',
  capricorn: 'Capricorn', capricornus: 'Capricorn', aquarius: 'Aquarius', pisces: 'Pisces',
};

/** يرجع الاسم الإنجليزي إن كان المفتاح اسماً إنجليزياً معروفاً، وإلا يرجع `fallbackAr`. */
export function zodiacName(key: string, fallbackAr: string, lang: Lang): string {
  return lang === 'en' ? ZODIAC_EN[key.toLowerCase()] ?? fallbackAr : fallbackAr;
}

export const CITIES = [
  { id: 'c_tunis', lat: 36.8065, lon: 10.1815 },
  { id: 'c_mecca', lat: 21.4225, lon: 39.8262 },
  { id: 'c_cairo', lat: 30.0444, lon: 31.2357 },
  { id: 'c_riyadh', lat: 24.7136, lon: 46.6753 },
  { id: 'c_istanbul', lat: 41.0082, lon: 28.9784 },
  { id: 'c_london', lat: 51.5074, lon: -0.1278 },
  { id: 'c_newyork', lat: 40.7128, lon: -74.006 },
  { id: 'c_jakarta', lat: -6.2088, lon: 106.8456 },
] as const;

/** اسم الكوكبة بلغة التطبيق (الإنجليزية إن توفر nameEn، وإلا العربية) */
export function groupName(g: { nameAr: string; nameEn?: string | null }, lang: Lang): string {
  return lang === 'en' && g.nameEn ? g.nameEn : g.nameAr;
}

/** أقمار المشتري الأربعة الكبرى */
export const JUPITER_MOON_NAMES: Record<string, { ar: string; en: string }> = {
  io: { ar: 'آيو', en: 'Io' },
  europa: { ar: 'أوروبا', en: 'Europa' },
  ganymede: { ar: 'غانيميد', en: 'Ganymede' },
  callisto: { ar: 'كاليستو', en: 'Callisto' },
};
