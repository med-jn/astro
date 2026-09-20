import type { Degrees } from '../types/astro';
import { normalizeDeg } from './bodies';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface LunarMansion {
  index: number; // 0..27
  nameAr: string;
  transliteration: string;
  season: Season;
  startLongitudeDeg: Degrees;
  endLongitudeDeg: Degrees;
}

// كل منزلة تغطي 360/28 درجة بالضبط (12° 51′ 25.71″) بدءاً من نقطة الاعتدال الربيعي (لامدا=0)
export const MANSION_SPAN_DEG: Degrees = 360 / 28;

const MANSION_NAMES: Omit<LunarMansion, 'startLongitudeDeg' | 'endLongitudeDeg'>[] = [
  { index: 0, nameAr: 'الشرطين', transliteration: 'Al-Sharatain', season: 'spring' },
  { index: 1, nameAr: 'البطين', transliteration: 'Al-Butain', season: 'spring' },
  { index: 2, nameAr: 'الثريا', transliteration: 'Al-Thurayya', season: 'spring' },
  { index: 3, nameAr: 'الدبران', transliteration: 'Al-Dabaran', season: 'spring' },
  { index: 4, nameAr: "الهقعة", transliteration: "Al-Haq'ah", season: 'spring' },
  { index: 5, nameAr: "الهنعة", transliteration: "Al-Han'ah", season: 'spring' },
  { index: 6, nameAr: 'الذراع', transliteration: "Al-Dhira'", season: 'spring' },
  { index: 7, nameAr: 'النثرة', transliteration: 'Al-Nathrah', season: 'summer' },
  { index: 8, nameAr: 'الطرف', transliteration: 'Al-Tarf', season: 'summer' },
  { index: 9, nameAr: 'الجبهة', transliteration: 'Al-Jabhah', season: 'summer' },
  { index: 10, nameAr: 'الزبرة', transliteration: 'Al-Zubrah', season: 'summer' },
  { index: 11, nameAr: 'الصرفة', transliteration: 'Al-Sarfah', season: 'summer' },
  { index: 12, nameAr: "العواء", transliteration: "Al-'Awwa'", season: 'summer' },
  { index: 13, nameAr: 'السماك', transliteration: 'Al-Simak', season: 'summer' },
  { index: 14, nameAr: 'الغفر', transliteration: 'Al-Ghafr', season: 'autumn' },
  { index: 15, nameAr: 'الزبانا', transliteration: 'Al-Zubana', season: 'autumn' },
  { index: 16, nameAr: 'الإكليل', transliteration: 'Al-Iklil', season: 'autumn' },
  { index: 17, nameAr: 'القلب', transliteration: 'Al-Qalb', season: 'autumn' },
  { index: 18, nameAr: 'الشولة', transliteration: 'Al-Shaulah', season: 'autumn' },
  { index: 19, nameAr: "النعائم", transliteration: "Al-Na'a'im", season: 'autumn' },
  { index: 20, nameAr: 'البلدة', transliteration: 'Al-Baldah', season: 'autumn' },
  { index: 21, nameAr: 'سعد الذابح', transliteration: 'Sa\'d al-Dhabih', season: 'winter' },
  { index: 22, nameAr: "سعد بلع", transliteration: "Sa'd Bula'", season: 'winter' },
  { index: 23, nameAr: "سعد السعود", transliteration: "Sa'd al-Su'ud", season: 'winter' },
  { index: 24, nameAr: 'سعد الأخبية', transliteration: 'Sa\'d al-Akhbiyah', season: 'winter' },
  { index: 25, nameAr: 'الفرغ المقدم', transliteration: 'Al-Fargh al-Muqdim', season: 'winter' },
  { index: 26, nameAr: 'الفرغ المؤخر', transliteration: "Al-Fargh al-Mu'akhkhar", season: 'winter' },
  { index: 27, nameAr: 'الرشاء', transliteration: "Al-Rasha'", season: 'winter' },
];

const ALL_MANSIONS: LunarMansion[] = MANSION_NAMES.map((m) => ({
  ...m,
  startLongitudeDeg: m.index * MANSION_SPAN_DEG,
  endLongitudeDeg: (m.index + 1) * MANSION_SPAN_DEG,
}));

export function getAllLunarMansions(): LunarMansion[] {
  return ALL_MANSIONS;
}

/** يحدد المنزلة القمرية بناءً على خط الطول البروجي الحقيقي (لامدا) لأي جرم */
export function getMansionByEclipticLongitude(longitudeDeg: Degrees): LunarMansion {
  const norm = normalizeDeg(longitudeDeg);
  const index = Math.min(27, Math.floor(norm / MANSION_SPAN_DEG));
  return ALL_MANSIONS[index];
}
