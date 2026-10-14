/**
 * حساب إضاءة قرص القمر بكسل بكسل (بلا DOM — قابل للاختبار).
 *
 * النموذج: قانون Lommel–Seeliger لانعكاس سطح القمر، وهو أقرب للواقع من لامبرت:
 *   I = 2·μ0 / (μ0 + μ)
 * حيث μ0 جيب تمام زاوية سقوط الضوء وμ جيب تمام زاوية الرصد. النتيجة:
 *  - قرص البدر مسطّح السطوع تقريباً (كما في الواقع) لا يخفت نحو الأطراف،
 *  - انتقال متدرّج وطبيعي بين المنطقة المضيئة والمظلمة عند حد الطور (مع معامل تقوية يجعل الحد أوضح قليلاً كما يُرى بالعين)،
 *  - الجزء المظلم لا يسود تماماً بل يحتفظ بضوء رمادي خافت.
 *
 * إطار الصورة: قطب القمر الشمالي للأعلى، والشرق يسار (كما يُرى بالعين المجردة من نصف الكرة الشمالي).
 */

import type { EclipseLook, Rgb } from './eclipseLooks';

export interface DarkRegion {
  /** مركز منطقة الإظلام بالنسبة لمركز القمر (بوحدة نصف قطر القمر)، في إطار قطب القمر للأعلى */
  cx: number;
  cy: number;
  coreR: number;
  haloR: number;
  look?: EclipseLook;
}

export interface ShadeParams {
  sepDeg: number;      // البعد الزاوي بين القمر والشمس
  pa: number;          // اتجاه الشمس من القمر مقيساً من قطب القمر الشمالي نحو الشرق (°)
  dark?: DarkRegion;   // منطقة إظلام (الخسوف)
  boost?: number;      // إضاءة إضافية قرب الاكتمال (0..~0.34): تُضاف بيضاء على الجزء المضيء
}

const RAD = Math.PI / 180;
const FALLBACK_LOOK: EclipseLook = {
  id: 'l3', rim: [1.0, 0.82, 0.48], mid: [0.72, 0.24, 0.1], deep: [0.38, 0.08, 0.04], swatch: '#b8431f',
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** حافة → وسط (عند 0.35) → عمق */
function lookColor(l: EclipseLook, t: number): Rgb {
  return t < 0.35 ? mix(l.rim, l.mid, smoothUnit(t / 0.35)) : mix(l.mid, l.deep, smoothUnit((t - 0.35) / 0.65));
}
const smoothUnit = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** نسيج بديل عند تعذّر تحميل الصورة: رمادي مع تباين خفيف يشبه البحار القمرية. */
function proceduralAlbedo(x: number, y: number): number {
  const m =
    0.5 * Math.sin(x * 5.1 + 1.3) * Math.cos(y * 4.3) +
    0.3 * Math.sin(x * 11.7 - y * 9.1) +
    0.2 * Math.cos(x * 23.0 + y * 17.0);
  return 0.62 + 0.1 * m;
}

export function shadeMoon(tex: Uint8ClampedArray | null, N: number, p: ShadeParams): Uint8ClampedArray {
  const out = new Uint8ClampedArray(N * N * 4);
  const sep = p.sepDeg * RAD;
  const sinS = Math.sin(sep);
  const sx = sinS * -Math.sin(p.pa * RAD);
  const sy = sinS * Math.cos(p.pa * RAD);
  const sz = -Math.cos(sep);
  const earthshine = 0.04;
  const tint = [0.86, 0.96, 1.16];

  for (let j = 0; j < N; j++) {
    const y = 1 - ((j + 0.5) / N) * 2;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1;
      const r2 = x * x + y * y;
      const idx = (j * N + i) * 4;
      if (r2 >= 1.02) continue;
      const r = Math.sqrt(r2);
      const z = Math.sqrt(Math.max(0, 1 - r2));
      const mu0 = x * sx + y * sy + z * sz;
      let lit = 0;
      if (mu0 > 0) lit = Math.min(1, (2.6 * mu0) / (mu0 + z + 1e-4)); // معامل 2.6: حدّ طور أوضح قليلاً مع بقاء التدرج

      let cr: number, cg: number, cb: number;
      if (tex) {
        cr = tex[idx] / 255; cg = tex[idx + 1] / 255; cb = tex[idx + 2] / 255;
      } else {
        cr = cg = cb = proceduralAlbedo(x, y);
      }

      let R = cr * (lit * (1 - earthshine) + earthshine * tint[0]);
      let G = cg * (lit * (1 - earthshine) + earthshine * tint[1]);
      let B = cb * (lit * (1 - earthshine) + earthshine * tint[2]);

      if (p.dark) {
        const d = p.dark;
        const dist = Math.hypot(x - d.cx, y - d.cy);
        const halo = smooth(0, 1, (d.haloR - dist) / Math.max(1e-3, d.haloR - d.coreR));
        const dim = 1 - 0.32 * halo;
        // وزن المنطقة العميقة: 1 داخلها، 0 خارجها، بحافة ناعمة
        const w = 1 - smooth(d.coreR - 0.05, d.coreR + 0.06, dist);
        let mr = 1, mg = 1, mb = 1;
        if (w > 0) {
          const look = d.look ?? FALLBACK_LOOK;
          const tt = clamp01(1 - dist / d.coreR);          // 0 عند الحافة … 1 في المركز
          const c = lookColor(look, tt);
          mr = 1 - w + w * c[0];
          mg = 1 - w + w * c[1];
          mb = 1 - w + w * c[2];
        }
        R *= dim * mr;
        G *= dim * mg;
        B *= dim * mb;
      }

      if (p.boost && lit > 0) {
        R += p.boost * lit;
        G += p.boost * lit;
        B += p.boost * lit;
      }

      out[idx] = R * 255;
      out[idx + 1] = G * 255;
      out[idx + 2] = B * 255;
      out[idx + 3] = clamp01((1 - r) * N * 0.5 + 0.5) * 255; // حافة ناعمة بلا إطار
    }
  }
  return out;
}
