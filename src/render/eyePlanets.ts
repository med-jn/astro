import type { V3 } from '../core/camera';

/**
 * الكواكب أجساماً حقيقية في عين الراصد: قرص بنصف قطره الفيزيائي ÷ المسافة × مقياس العدسة (فيتّسع مع الزوم)،
 * تفلطح قطبي، طور مضاء بنموذج إضاءة، شرائط المشتري وزحل، وحلقات زحل بميلها (B) واتجاهها من محور دورانه الحقيقي،
 * وأقمار المشتري الغاليلية بمواضعها الحقيقية. النقطة (النجمية) تبقى لما دون حدّ التمييز (< ~1 بكسل).
 *
 * الثوابت: أنصاف الأقطار الاستوائية/القطبية (كم) من IAU WGCCRE 2015 / جداول ناسا للكواكب؛ حدود حلقات زحل (كم) من جدول
 * PDS Rings Node (pds-rings.seti.org، بيانات كاسيني): فجوة كاسيني 117,500–122,050 · حلقة A 122,050–136,770؛ حافتا C/B الداخليتان تقريبيتان (92,000 كم)؛ ونصف قطر زحل 60,268.
 * ما لم يُنمذَج صراحةً: ظل الحلقات على الكوكب وظل الكوكب على الحلقات، والبقعة الحمراء، وتفاصيل سطح المريخ الفعلية.
 */
const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const PLANET_RADII_KM: Record<string, { eq: number; pol: number }> = {
  Mercury: { eq: 2439.7, pol: 2439.7 },
  Venus: { eq: 6051.8, pol: 6051.8 },
  Mars: { eq: 3396.2, pol: 3376.2 },
  Jupiter: { eq: 71492, pol: 66854 },
  Saturn: { eq: 60268, pol: 54364 },
  Uranus: { eq: 25559, pol: 24973 },
  Neptune: { eq: 24764, pol: 24341 },
};
const SAT_R = 60268;
/** حلقات زحل بوحدة نصف القطر الاستوائي: [داخلي، خارجي، لون، شفافية] */
export const SATURN_RINGS: { a: number; b: number; col: [number, number, number]; alpha: number }[] = [
  { a: 74658 / SAT_R, b: 92000 / SAT_R, col: [150, 136, 112], alpha: 0.28 },   // C
  { a: 92000 / SAT_R, b: 117500 / SAT_R, col: [228, 210, 172], alpha: 0.93 },  // B
  { a: 117500 / SAT_R, b: 122050 / SAT_R, col: [60, 52, 42], alpha: 0.06 },    // فجوة كاسيني
  { a: 122050 / SAT_R, b: 136770 / SAT_R, col: [208, 190, 154], alpha: 0.76 }, // A
];
export const SATURN_RING_OUTER = 136770 / SAT_R;

export interface PlanetPhys {
  distAu: number;                       // مسافة الأرض–الكوكب
  phaseFraction: number;                // المضيء 0..1
  geoEqj: V3;                           // متجه مركز الكوكب من مركز الأرض (وحدة فلكية، EQJ)
  poleEqj: V3 | null;                   // متجه الوحدة نحو قطبه الشمالي (EQJ)
  moons: { key: string; rel: V3 }[] | null; // أقمار المشتري بالنسبة لمركزه (وحدة فلكية، EQJ)
}
export interface PlanetEnv {
  /** متجه EQJ → نقطة على الشاشة (false إن لم يظهر) */
  proj: (v: V3, out: { x: number; y: number }) => boolean;
  pxPerRad: number;
  /** اتجاه الشمس على الشاشة من الكوكب (وحدة) أو null */
  sunDirScreen: { x: number; y: number } | null;
  alpha: number;
  moonLabel?: (key: string) => string;
}

const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x: number, c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));

type RGB = [number, number, number];
/** لون سطح الكوكب عند خط عرض lat (راد) ونقطة (x,y,z) على قرص الوحدة */
function albedo(name: string, lat: number, x: number): RGB {
  const L = lat / DEG;
  if (name === 'Jupiter') {
    let belt = 0;
    belt += gauss(L, 13, 4.2) * 0.85 + gauss(L, -15, 4.6) * 0.95 + gauss(L, 26, 2.6) * 0.45 + gauss(L, -28, 2.8) * 0.4 + gauss(L, 40, 3) * 0.25 + gauss(L, -42, 3) * 0.25;
    belt = Math.min(1, belt + 0.06 * Math.sin(L * 0.9 + x * 2.2));
    const pol = smooth(58, 80, Math.abs(L));
    const zone: RGB = [236, 218, 182], bl: RGB = [178, 116, 82], pl: RGB = [164, 142, 122];
    const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    return mix(mix(zone, bl, belt), pl, pol * 0.7);
  }
  if (name === 'Saturn') {
    const b = 0.5 + 0.5 * Math.sin(L * 0.55 + 0.4) + 0.25 * Math.sin(L * 1.5);
    const pol = smooth(62, 85, Math.abs(L));
    return [228 - 20 * b - 40 * pol, 206 - 22 * b - 38 * pol, 160 - 22 * b - 30 * pol];
  }
  if (name === 'Venus') { const s = 0.025 * Math.sin(L * 0.8 + x * 3); return [246 + 6 * s, 238 + 8 * s, 214 + 10 * s]; }
  if (name === 'Mars') {
    const n = Math.sin(x * 6 + L * 0.14) * Math.sin(L * 0.31 + 1.2) + 0.5 * Math.sin(x * 11 - L * 0.2);
    const dark = smooth(0.15, 0.9, n) * 0.38;
    const cap = smooth(76, 84, Math.abs(L));
    const c: RGB = [206 - 66 * dark, 126 - 40 * dark, 80 - 22 * dark];
    return [c[0] + (246 - c[0]) * cap, c[1] + (244 - c[1]) * cap, c[2] + (240 - c[2]) * cap];
  }
  if (name === 'Mercury') { const n = 0.5 + 0.5 * Math.sin(x * 17 + L * 9) * Math.sin(L * 13 - x * 7); return [150 + 18 * n, 145 + 16 * n, 138 + 14 * n]; }
  if (name === 'Uranus') return [166, 214, 224];
  return [84, 126, 214]; // نبتون
}

const sprites = new Map<string, HTMLCanvasElement>();
/** قرص الكوكب بإضاءة الطور؛ نظام الإحداثيات: القطب الشمالي نحو الأعلى (−y)، الشمس نحو الزاوية sunLocal */
function planetSprite(name: string, alphaDeg: number, sunLocal: number, N: number): HTMLCanvasElement {
  const key = `${name}|${Math.round(alphaDeg)}|${Math.round((sunLocal / DEG) / 6)}|${N}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const R = PLANET_RADII_KM[name], f = R.pol / R.eq;
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const g = c.getContext('2d')!, img = g.createImageData(N, N), d = img.data;
  const sa = Math.sin(alphaDeg * DEG), ca = Math.cos(alphaDeg * DEG);
  const sx = Math.cos(sunLocal) * sa, sy = Math.sin(sunLocal) * sa, sz = ca;
  const rocky = name === 'Mercury' || name === 'Mars';
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N) * 2 - 1, yy = y / f;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1, r2 = x * x + yy * yy, k = (j * N + i) * 4;
      if (r2 >= 1.03) { d[k + 3] = 0; continue; }
      const z = Math.sqrt(Math.max(0, 1 - r2));
      const mu0 = x * sx + yy * sy + z * sz;
      const edge = Math.max(0, Math.min(1, (1.03 - r2) / 0.06)); // حافة ناعمة
      let I = 0;
      if (mu0 > 0) I = rocky ? Math.min(1.05, (2 * mu0) / (mu0 + z + 1e-6)) : Math.pow(mu0, 0.85) * (0.55 + 0.45 * Math.pow(z, 0.5)) * 1.08;
      const col = albedo(name, Math.asin(Math.max(-1, Math.min(1, -yy))), x);
      d[k] = Math.min(255, col[0] * I); d[k + 1] = Math.min(255, col[1] * I); d[k + 2] = Math.min(255, col[2] * I);
      d[k + 3] = 255 * edge * smooth(0, 0.07, mu0);
    }
  }
  g.putImageData(img, 0, 0);
  if (sprites.size > 80) sprites.clear();
  sprites.set(key, c);
  return c;
}

export interface PlanetResult { drawn: boolean; extentPx: number; eqPx: number }

/** يرسم الكوكب إن كان قابلاً للتمييز (≥ ~1 بكسل)؛ وإلا يُرجع drawn=false فيُرسم نقطة نجمية */
export function paintPlanetResolved(ctx: CanvasRenderingContext2D, name: string, phys: PlanetPhys, x: number, y: number, env: PlanetEnv): PlanetResult {
  const R = PLANET_RADII_KM[name];
  if (!R) return { drawn: false, extentPx: 0, eqPx: 0 };
  const eqPx = (R.eq / (phys.distAu * AU_KM)) * env.pxPerRad;
  const ringed = name === 'Saturn';
  const extentPx = eqPx * (ringed ? SATURN_RING_OUTER : 1);
  if (extentPx < 0.9) return { drawn: false, extentPx, eqPx };

  // اتجاه القطب الشمالي على الشاشة وميل مستوى الاستواء نحو الراصد (B)
  const u = norm(phys.geoEqj);
  let poleAng = -Math.PI / 2, B = 0;
  if (phys.poleEqj) {
    const p = norm(phys.poleEqj), pu = dot(p, u);
    B = Math.asin(Math.max(-1, Math.min(1, -pu)));
    const pp = norm([p[0] - u[0] * pu, p[1] - u[1] * pu, p[2] - u[2] * pu]);
    const a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
    if (env.proj(u, a) && env.proj(norm([u[0] + pp[0] * 0.002, u[1] + pp[1] * 0.002, u[2] + pp[2] * 0.002]), b)) poleAng = Math.atan2(b.y - a.y, b.x - a.x);
  }
  const phi = poleAng + Math.PI / 2; // بعد التدوير: «أعلى» محلي = القطب الشمالي
  const k = Math.max(0, Math.min(1, phys.phaseFraction));
  const alphaDeg = (Math.acos(Math.max(-1, Math.min(1, 2 * k - 1))) * 180) / Math.PI;
  const sunLocal = env.sunDirScreen ? Math.atan2(env.sunDirScreen.y, env.sunDirScreen.x) - phi : 0;
  const N = Math.max(16, Math.min(256, Math.ceil(eqPx * 2.4)));
  const sprite = planetSprite(name, env.sunDirScreen ? alphaDeg : 0, sunLocal, N);

  ctx.save();
  ctx.translate(x, y); ctx.rotate(phi);
  ctx.globalAlpha = env.alpha;
  // توهج خفيف للأجرام الساطعة
  const glowR = Math.max(extentPx * 1.9, 5);
  const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
  gl.addColorStop(0, 'rgba(255,248,230,0.20)'); gl.addColorStop(1, 'rgba(255,248,230,0)');
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  const sinB = Math.abs(Math.sin(B));
  const half = (front: boolean) => { // نصف الحلقة الأقرب/الأبعد: عند B>0 يكون الأقرب هو النصف السفلي (جنوب)
    const lower = front ? B > 0 : B <= 0;
    ctx.beginPath();
    if (lower) ctx.rect(-extentPx * 3, 0, extentPx * 6, extentPx * 3); else ctx.rect(-extentPx * 3, -extentPx * 3, extentPx * 6, extentPx * 3);
    ctx.clip();
  };
  const rings = () => {
    for (const r of SATURN_RINGS) {
      const ao = r.b * eqPx, ai = r.a * eqPx;
      const bo = Math.max(0.5, ao * sinB), bi = Math.max(0.35, ai * sinB);
      ctx.beginPath();
      ctx.ellipse(0, 0, ao, bo, 0, 0, Math.PI * 2);
      ctx.ellipse(0, 0, ai, bi, 0, 0, Math.PI * 2, true);
      ctx.fillStyle = `rgba(${r.col[0]},${r.col[1]},${r.col[2]},${(r.alpha * env.alpha).toFixed(3)})`;
      ctx.fill('evenodd');
    }
  };
  if (ringed) { ctx.save(); half(false); rings(); ctx.restore(); }      // النصف الأبعد خلف الكوكب
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sprite, -eqPx * 1.015, -eqPx * 1.015, eqPx * 2.03, eqPx * 2.03);
  if (ringed) { ctx.save(); half(true); rings(); ctx.restore(); }       // النصف الأقرب أمامه
  ctx.restore();

  // أقمار المشتري الغاليلية بمواضعها الحقيقية
  if (phys.moons && eqPx >= 0.6) {
    const q = { x: 0, y: 0 };
    for (const m of phys.moons) {
      const v: V3 = [phys.geoEqj[0] + m.rel[0], phys.geoEqj[1] + m.rel[1], phys.geoEqj[2] + m.rel[2]];
      if (!env.proj(norm(v), q)) continue;
      const depth = dot(m.rel, u); // >0: أبعد من الكوكب
      const dx = q.x - x, dy = q.y - y;
      // خلف القرص: محجوب
      const c = Math.cos(-phi), s = Math.sin(-phi);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      const f = R.pol / R.eq;
      if (depth > 0 && (lx * lx) / (eqPx * eqPx) + (ly * ly) / (eqPx * f * eqPx * f) < 0.96) continue;
      ctx.save(); ctx.globalAlpha = env.alpha;
      ctx.fillStyle = 'rgba(250,246,236,0.95)'; ctx.beginPath(); ctx.arc(q.x, q.y, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (env.moonLabel && Math.hypot(dx, dy) > 16) {
        ctx.save(); ctx.globalAlpha = env.alpha * 0.9; ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = '#dbe4ee'; ctx.textAlign = 'center';
        ctx.fillText(env.moonLabel(m.key), q.x, q.y - 6); ctx.restore();
      }
    }
  }
  return { drawn: true, extentPx, eqPx };
}
