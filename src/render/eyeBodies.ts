import { getMoonImage, MOON_IMAGE_ROTATION_CCW_DEG } from './bodyImages';
import { paintDomeSun } from './observerDome';
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
  // قصّ بحدّ القرص
  g.save(); g.globalCompositeOperation = 'destination-in';
  g.beginPath(); g.arc(Rl, Rl, Rl - 0.25, 0, Math.PI * 2); g.fillStyle = '#000'; g.fill();
  g.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // الغلاف الجوي أمام القمر: الضوء المبعثر يُضاف ولا يُحجَب
  ctx.globalAlpha = Math.max(0, Math.min(1, o.brightness));
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, x - R, y - R, 2 * R, 2 * R);
  ctx.restore();
  return true;
}

/** معامل تفلطح قرص الشمس الرأسي بالانكسار الجوي (1 = بلا تفلطح؛ ~0.8 عند الأفق) */
export function refractionFlatten(apparentAltDeg: number, radiusDeg: number): number {
  const a = apparentAltDeg - refractionDeg(Math.max(apparentAltDeg, -1));
  const top = a + radiusDeg + refractionDeg(a + radiusDeg), bot = a - radiusDeg + refractionDeg(Math.max(-1, a - radiusDeg));
  return Math.max(0.5, Math.min(1, (top - bot) / (2 * radiusDeg)));
}

/**
 * قرص الشمس: اللون والوهج من paintDomeSun (المصدر المشترك: يتغيّر بحسب الارتفاع؛ أحمر قرب الأفق وأبيض عالياً)،
 * مضغوطاً رأسياً بمعامل الانكسار على محور السمت (zenAng = اتجاه السمت على الشاشة).
 */
export function paintEyeSun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, altApp: number, flatten: number, zenAng: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(zenAng); ctx.scale(flatten, 1); ctx.rotate(-zenAng);
  paintDomeSun(ctx, 0, 0, r, altApp);
  ctx.restore();
}
