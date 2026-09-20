export interface ZodiacConstellation {
  nameAr: string;
  segments: ([number, number] | null)[][]; // كل نقطة: [RA بالساعات، Dec بالدرجات]
}

export const ZODIAC_ORDER = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpius', 'Sagittarius', 'Capricornus', 'Aquarius', 'Pisces',
] as const;

export type ZodiacKey = (typeof ZODIAC_ORDER)[number];

// رموز الأبراج الفلكية اليونيكود القياسية — للاستخدام في لوحة التحكم بدل النص
export const ZODIAC_SYMBOLS: Record<ZodiacKey, string> = {
  Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋', Leo: '♌', Virgo: '♍',
  Libra: '♎', Scorpius: '♏', Sagittarius: '♐', Capricornus: '♑', Aquarius: '♒', Pisces: '♓',
};

let cached: Record<string, ZodiacConstellation> = {};
let loadPromise: Promise<Record<string, ZodiacConstellation>> | null = null;

export function loadZodiacData(): Promise<Record<string, ZodiacConstellation>> {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(`${import.meta.env.BASE_URL}data/zodiac.json`)
    .then((res) => res.json())
    .then((data: Record<string, ZodiacConstellation>) => {
      cached = data;
      return data;
    })
    .catch((err) => {
      console.error('فشل تحميل بيانات الأبراج:', err);
      return {};
    });
  return loadPromise;
}

export function getLoadedZodiac(): Record<string, ZodiacConstellation> {
  return cached;
}
