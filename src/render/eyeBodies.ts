import { getMoonImage, MOON_IMAGE_ROTATION_CCW_DEG } from './bodyImages';
import { directSunLight } from '../core/skyRadiance';
import { refractionDeg } from '../core/skyModel';

/**
 * الشمس والقمر في «عين الراصد»: أحجام حقيقية (نصف القطر الزاوي × مقياس العدسة)، وألوان وسطوع من المصدر المشترك
 * (paintDomeSun للقرص ولونه بحسب الارتفاع)، وتبقى الصورة والتدوير وعلامات الكسوف من الدوال المشتركة في المشروع.
 *
 * القمر: تُضرب صورة القمر (بتدويرها المشترك moonTexFromAxes) في خريطة إضاءة تُحسب بقانون لومل–سيليغر
 *   L ∝ 2·μ₀ / (μ₀ + μ)   حيث μ₀ = cos(زاوية السقوط) و μ = cos(زاوية الرؤية)
 * فيظهر تدرّج المنطقة الفاصلة الحقيقي (لا حدّ هندسي صلب) والقمر الكامل مسطّحاً كما هو في الواقع، ثم يُضاف ضوء الأرض
 * خافتاً على الجانب المظلم. تُخزَّن خريطة الإضاءة مؤقتاً بدقة 0.25° من زاوية الطور.
 */
const DEG = Math.PI / 180;
const SHADE_N = 256;
let shade: { key: number; canvas: HTMLCanvasElement } | null = null;
let layer: HTMLCanvasElement | null = null;

/** خريطة الإضاءة (رمادية) في إطار تكون فيه الشمس نحو +x؛ α = زاوية الطور */
function shadeSprite(alphaDeg: number): HTMLCanvasElement {
  const key = Math.round(alphaDeg * 4);
  if (shade && shade.key === key) return shade.canvas;
  const c = shade?.canvas ?? document.createElement('canvas');
  c.width = SHADE_N; c.height = SHADE_N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(SHADE_N, SHADE_N), d = img.data;
  const sa = Math.sin((key / 4) * DEG), ca = Math.cos((key / 4) * DEG);
  for (let j = 0; j < SHADE_N; j++) {
    const y = ((j + 0.5) / SHADE_N) * 2 - 1;
    for (let i = 0; i < SHADE_N; i++) {
      const x = ((i + 0.5) / SHADE_N) * 2 - 1, r2 = x * x + y * y, k = (j * SHADE_N + i) * 4;
      if (r2 >= 1) { d[k] = d[k + 1] = d[k + 2] = d[k + 3] = 0; continue; }
      const z = Math.sqrt(1 - r2);
      const mu0 = x * sa + z * ca;
      const S = mu0 > 0 ? Math.min(1.04, (2 * mu0) / (mu0 + z)) : 0;
      d[k] = d[k + 1] = d[k + 2] = Math.round(255 * Math.pow(S, 1 / 2.2)); // ضرب في فضاء العرض ≈ ضرب خطي
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  shade = { key, canvas: c };
  return c;
}

export interface MoonPaint {
  /** اتجاه الشمس على الشاشة من مركز القمر (راد) */
  sunDirAngle: number;
  /** تدوير صورة القمر واحتمال انعكاسها (moonTexFromAxes) */
  tex: { rotRad: number; mirror: boolean };
  /** نسبة المضيء 0..1 */
  phaseFraction: number;
  /** معامل السطوع الظاهري 0..1 بحسب تعريض المشهد (القمر نهاراً أشحب) */
  brightness: number;
  /** الطبقة الجوية: لون الضوء المنقول (يحمرّ قرب الأفق) ونعومة الحواف */
  tint?: [number, number, number];
  haze?: number;
}

/** يرسم القمر المضاء بالشمس وضوء الأرض؛ يعيد false إن لم تُحمَّل الصورة بعد */
export function paintEyeMoon(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, o: MoonPaint): boolean {
  const img = getMoonImage();
  if (!img || R < 2) return false;
  const Rl = Math.max(16, Math.min(640, Math.round(R))), size = Rl * 2;
  if (!layer) layer = document.createElement('canvas');
  if (layer.width !== size) { layer.width = size; layer.height = size; }
  const g = layer.getContext('2d')!;
  const k = Math.max(0, Math.min(1, o.phaseFraction));
  const alphaDeg = (Math.acos(Math.max(-1, Math.min(1, 2 * k - 1))) * 180) / Math.PI;

  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.clearRect(0, 0, size, size);
  const drawAlbedo = () => {
    g.save(); g.translate(Rl, Rl);
    g.rotate(o.tex.rotRad);
    if (o.tex.mirror) g.scale(-1, 1);
    g.rotate(MOON_IMAGE_ROTATION_CCW_DEG * DEG);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, -Rl, -Rl, size, size);
    g.restore();
  };
  drawAlbedo();
  // الإضاءة: ضرب في خريطة لومل–سيليغر (الشمس نحو اتجاهها الحقيقي على الشاشة)
  g.save(); g.globalCompositeOperation = 'multiply';
  g.translate(Rl, Rl); g.rotate(o.sunDirAngle);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(shadeSprite(alphaDeg), -Rl, -Rl, size, size);
  g.restore();
  // ضوء الأرض: الجانب المظلم يُرى خافتاً (أقوى ما يكون عند المحاق)، ويبرز فيه الجانب الفاتح من البحار قليلاً
  const earth = 0.055 * Math.pow(1 - k, 1.6);
  if (earth > 0.002) {
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = earth;
    drawAlbedo();
    g.restore();
  }
  // الطبقة الجوية: يُضرب الضوء بنسبة النفاذية اللونية (القمر المنخفض أحمر/برتقالي)
  if (o.tint && (o.tint[0] < 0.995 || o.tint[1] < 0.995 || o.tint[2] < 0.995)) {
    g.save(); g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${Math.round(o.tint[0] * 255)},${Math.round(o.tint[1] * 255)},${Math.round(o.tint[2] * 255)})`;
    g.fillRect(0, 0, size, size); g.restore();
  }
  // قصّ بحدّ القرص
  g.save(); g.globalCompositeOperation = 'destination-in';
  g.beginPath(); g.arc(Rl, Rl, Rl - 0.25, 0, Math.PI * 2); g.fillStyle = '#000'; g.fill();
  g.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // الغلاف الجوي أمام القمر: الضوء المبعثر يُضاف ولا يُحجَب
  ctx.globalAlpha = Math.max(0, Math.min(1, o.brightness));
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, x - R, y - R, 2 * R, 2 * R);
  // ضبابية خفيفة قرب الأفق: نسخة أكبر قليلاً وأخفت تنعّم الحافة
  const hz = o.haze ?? 0;
  if (hz > 0.04) { ctx.globalAlpha = Math.max(0, Math.min(1, o.brightness)) * 0.5 * hz; ctx.drawImage(layer, x - R * (1 + 0.07 * hz), y - R * (1 + 0.07 * hz), 2 * R * (1 + 0.07 * hz), 2 * R * (1 + 0.07 * hz)); }
  ctx.restore();
  return true;
}

/** معامل تفلطح قرص الشمس الرأسي بالانكسار الجوي (1 = بلا تفلطح؛ ~0.8 عند الأفق) */
export function refractionFlatten(apparentAltDeg: number, radiusDeg: number): number {
  const a = apparentAltDeg - refractionDeg(Math.max(apparentAltDeg, -1));
  const top = a + radiusDeg + refractionDeg(a + radiusDeg), bot = a - radiusDeg + refractionDeg(Math.max(-1, a - radiusDeg));
  return Math.max(0.5, Math.min(1, (top - bot) / (2 * radiusDeg)));
}

const lumY = (r: number[]) => 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
const REF_SUN_LUM = lumY(directSunLight(60).rgb);
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const enc = (v: number) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));
const mix3 = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * قرص الشمس: لونه من جدول الانتقال الجوي نفسه الذي تُحسب به السماء (directSunLight: كتلة هوائية + رايلي + هباء + أوزون):
 * أبيض مصفرّ عالياً، ثم برتقالي فأحمر مشبع كلما اقترب من الأفق (عند 0°: 1 : 0.12 : 0.003). تعتيم الحافة، وتفلطح رأسي
 * بالانكسار على محور السمت (zenAng). وهج الهالة من نسيج السماء (يتضمن ضوء الهباء الأمامي) فلا وهج مصطنع هنا.
 */
export function paintEyeSun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, altApp: number, flatten: number, zenAng: number, skyRGB?: [number, number, number] | null, haze = 0): void {
  const rgb = directSunLight(Math.max(altApp, -0.5)).rgb;
  const m = Math.max(rgb[0], rgb[1], rgb[2]) || 1;
  const rel = [rgb[0] / m, rgb[1] / m, rgb[2] / m];
  const white = 0.1 + 0.8 * sm(0.05, 0.5, lumY(rgb) / REF_SUN_LUM);
  let c0 = mix3([enc(rel[0]), enc(rel[1]), enc(rel[2])], [255, 252, 242], white);
  // القرص هو الأسطع دائماً: سطوعه أكبر من سماء ما حوله (يُبيَّض بقدر الحاجة)
  if (skyRGB) {
    const need = lumY(skyRGB) * 1.12 + 26, have = lumY(c0);
    if (have < need) c0 = mix3(c0, [255, 250, 238], Math.min(1, (need - have) / Math.max(1, 255 - have)));
  }
  const limb = [c0[0] * 0.9, c0[1] * 0.8, c0[2] * 0.66];
  const css = (c: number[], a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(zenAng); ctx.scale(flatten, 1); ctx.rotate(-zenAng);
  const glow = ctx.createRadialGradient(0, 0, r * 0.85, 0, 0, r * 2.0);
  glow.addColorStop(0, css(c0, 0.17 + 0.1 * haze)); glow.addColorStop(1, css(c0, 0));
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 2.0, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const soft = 0.97 - 0.2 * haze; // الضبابية الجوية قرب الأفق تنعّم الحافة
  const disc = ctx.createRadialGradient(0, 0, 0, 0, 0, r * (1 + 0.04 * haze));
  disc.addColorStop(0, css(c0)); disc.addColorStop(Math.max(0.3, soft - 0.19), css(mix3(c0, limb, 0.25))); disc.addColorStop(soft, css(limb)); disc.addColorStop(1, css(limb, 0.5 - 0.3 * haze));
  ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(0, 0, r * (1 + 0.04 * haze), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
