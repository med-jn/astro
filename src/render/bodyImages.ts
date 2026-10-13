/**
 * صور القمر والكواكب من public/images (تُحمَّل بكسل عند أول طلب وتُخزَّن؛ لا تُحمَّل شيئاً قبل الحاجة).
 *
 * ملاحظة على الأسماء: ملفا زحل وأورانوس عندك «Saturne.png» و«Uranys.png» (بخطأ إملائي)، وهذا الجدول يطابق
 * أسماءك كما هي؛ فإن أعدت تسميتها صحيحة غيّر القيمتين هنا فقط.
 */
const BASE: string = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

export const MOON_IMAGE_URL = `${BASE}images/moon.png`;

const PLANET_FILES: Record<string, string> = {
  Mercury: 'Mercury.png',
  Venus: 'Venus.png',
  Mars: 'Mars.png',
  Jupiter: 'Jupiter.png',
  Saturn: 'Saturne.png',
  Uranus: 'Uranys.png',
  Neptune: 'Neptune.png',
};

/**
 * اتجاه صورة القمر في ملفك: الصورة مدوَّرة عكس عقارب الساعة بنحو 19° عن الوضع القياسي (الشمال لأعلى، الشرق يميناً).
 * قيست بمطابقة ارتباطية مع خريطة سيلينوغرافية (بحر الأمطار/الصفاء/الأزمات وفوهة تيخو) بدقة ±3°.
 * إن بدّلت الصورة بأخرى اجعل القيمة 0 إن كانت قياسية.
 */
export const MOON_IMAGE_ROTATION_CCW_DEG = 19;

type Entry = { img: HTMLImageElement | null; state: 'idle' | 'loading' | 'ready' | 'failed' };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** يُستدعى كلما اكتمل تحميل صورة (ليعيد المستمع بناء ما يعتمد عليها) */
export function onBodyImageReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function request(url: string): HTMLImageElement | null {
  let e = cache.get(url);
  if (!e) {
    e = { img: null, state: 'idle' };
    cache.set(url, e);
  }
  if (e.state === 'ready') return e.img;
  if (e.state === 'idle' && typeof Image !== 'undefined') {
    e.state = 'loading';
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { e!.img = img; e!.state = 'ready'; listeners.forEach((l) => l()); };
    img.onerror = () => { e!.state = 'failed'; };
    img.src = url;
  }
  return null;
}

/** صورة القمر إن اكتمل تحميلها (وإلا null وتبدأ التحميل) */
export function getMoonImage(): HTMLImageElement | null {
  return request(MOON_IMAGE_URL);
}

/** صورة كوكب باسمه الإنجليزي كما في astronomy-engine (Mercury…Neptune) */
export function getPlanetImage(name: string): HTMLImageElement | null {
  const f = PLANET_FILES[name];
  return f ? request(`${BASE}images/planets/${f}`) : null;
}
