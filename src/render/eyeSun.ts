import { fbm } from './eyeBackground';

/**
 * قرص الشمس خلف فلتر شمسي (ضوء أبيض): تعتيم الحافة الحقيقي، وحُبيبات، وبقع شمسية.
 *  - اتجاه محور الشمس الحقيقي: B₀ (ميل محور الشمس نحو الأرض)، P (زاوية القطب)، L₀ (طول كارينغتون لمركز القرص)
 *    بمعادلات ميوس (Astronomical Algorithms، الفصل 29).
 *  - البقع: نموذج توضيحي حتمي (ليست بيانات رصد فعلية): مناطق نشطة تُولَد وتنمو وتخبو، وتدور بدوران الشمس التفاضلي
 *    (Ω = 14.713 − 2.396 sin²φ − 1.787 sin⁴φ °/يوم) ومواضعها على القرص بالإسقاط الهليومركزي الصحيح (انكماش قرب الحافة).
 */
const DEG = Math.PI / 180;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

export interface SolarPhysical { b0: number; l0: number; p: number }
/** B₀ وL₀ وP بالدرجات (ميوس 29): jd = اليوم اليولياني، raHours/decDeg إحداثيات الشمس الظاهرية */
export function solarPhysical(jd: number, raHours: number, decDeg: number): SolarPhysical {
  const T = (jd - 2451545) / 36525;
  const ra = raHours * 15 * DEG, dec = decDeg * DEG;
  const eps = (23.4392911 - 0.0130042 * T) * DEG;
  const lam = Math.atan2(Math.sin(ra) * Math.cos(eps) + Math.tan(dec) * Math.sin(eps), Math.cos(ra)) / DEG; // خط الطول الكسوفي
  const omega = 125.04 - 1934.136 * T;
  const lamP = lam - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const theta = ((jd - 2398220) * 360) / 25.38;
  const I = 7.25 * DEG, K = 73.6667 + (1.3958333 * (jd - 2396758)) / 36525;
  const x = Math.atan(-Math.cos(lamP * DEG) * Math.tan(eps)) / DEG;
  const y = Math.atan(-Math.cos((lam - K) * DEG) * Math.tan(I)) / DEG;
  const b0 = Math.asin(Math.sin((lam - K) * DEG) * Math.sin(I)) / DEG;
  const eta = Math.atan2(-Math.sin((lam - K) * DEG) * Math.cos(I), -Math.cos((lam - K) * DEG)) / DEG;
  return { b0, l0: norm360(eta - theta), p: x + y };
}

// ───────────────────────── البقع الشمسية (نموذج توضيحي حتمي) ─────────────────────────
const rnd = (seed: number) => { const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
export interface Spot { lat: number; lon: number; umbra: number; pen: number }
const BIN_DAYS = 2.4;
/** البقع عند اليوم اليولياني jd: لكل مجموعة (قائد + تابعات) مواضع هليوغرافية (كارينغتون) وأحجام بالنسبة لنصف قطر الشمس */
export function sunspotsAt(jd: number): Spot[] {
  const out: Spot[] = [];
  const k1 = Math.floor(jd / BIN_DAYS);
  for (let k = k1 - 14; k <= k1; k++) {
    if (rnd(k * 3.1) > 0.6) continue; // نشاط متوسط: ليست كل فترة تلد منطقة
    const t0 = k * BIN_DAYS + rnd(k + 0.5) * BIN_DAYS, life = 8 + 20 * rnd(k + 0.7);
    const age = jd - t0;
    if (age < 0 || age > life) continue;
    const env = Math.pow(Math.sin((Math.PI * age) / life), 0.7); // ينمو ثم يخبو
    const lat = (rnd(k + 0.2) < 0.5 ? -1 : 1) * (6 + 15 * rnd(k + 0.9));
    const s = Math.sin(lat * DEG), omega = 14.713 - 2.396 * s * s - 1.787 * s * s * s * s - 14.1844; // دوران كارينغتون
    const lon0 = 360 * rnd(k + 0.33), lonNow = norm360(lon0 + omega * age);
    const n = 2 + Math.floor(rnd(k + 0.41) * 5);
    for (let j = 0; j < n; j++) {
      const lead = j === 0;
      const um = (lead ? 0.028 : 0.009 + 0.012 * rnd(k * 7 + j)) * env;
      if (um < 0.0035) continue;
      out.push({ lat: lat + (rnd(k * 5 + j) - 0.5) * 3.2, lon: lonNow - (lead ? 0 : 2.2 + 1.7 * j + rnd(k + j) * 2), umbra: um, pen: um * 2.3 });
    }
  }
  return out;
}

// ───────────────────────── قرص الضوء الأبيض (مخزَّن مؤقتاً) ─────────────────────────
const N = 512;
let photo: HTMLCanvasElement | null = null;
function photosphere(): HTMLCanvasElement {
  if (photo) return photo;
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const g = c.getContext('2d')!, img = g.createImageData(N, N), d = img.data;
  const U = [0.5, 0.62, 0.78]; // تعتيم الحافة لكل قناة (الحافة أحمر قليلاً)
  const BASE = [255, 236, 205];
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N) * 2 - 1;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1, r2 = x * x + y * y, k = (j * N + i) * 4;
      if (r2 >= 1.002) { d[k + 3] = 0; continue; }
      const mu = Math.sqrt(Math.max(0, 1 - r2));
      const gran = (fbm(x * 55 + 3, y * 55 + 7, 3) - 0.5) * 0.14 * (0.35 + mu); // حُبيبات
      const fac = Math.pow(1 - mu, 1.8) * Math.max(0, fbm(x * 17 + 40, y * 17 + 5, 3) - 0.48) * 0.36; // سعف قرب الحافة
      for (let ch = 0; ch < 3; ch++) {
        const I = (1 - U[ch] * (1 - mu)) * (1 + gran) + fac;
        d[k + ch] = Math.max(0, Math.min(255, BASE[ch] * I));
      }
      d[k + 3] = Math.max(0, Math.min(255, (1.002 - r2) * 255 * 40));
    }
  }
  g.putImageData(img, 0, 0);
  photo = c;
  return c;
}

export interface SolarOrient { nx: number; ny: number; ex: number; ey: number }
/** يرسم الشمس خلف فلتر: n/e = اتجاها الشمال والشرق السماويين على الشاشة */
export function paintFilteredSun(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, o: SolarOrient, phys: SolarPhysical, jd: number): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photosphere(), x - R * 1.002, y - R * 1.002, R * 2.004, R * 2.004);
  // محور الشمس على الشاشة: شمال الشمس = شمال سماوي مُدار بزاوية P شرقاً؛ الغرب الشمسي عكس الشرق
  const p = phys.p * DEG, cp = Math.cos(p), sp = Math.sin(p);
  const Nx = o.nx * cp + o.ex * sp, Ny = o.ny * cp + o.ey * sp;          // شمال الشمس
  const Wx = -(o.ex * cp - o.nx * sp), Wy = -(o.ey * cp - o.ny * sp);      // غرب الشمس
  const b0 = phys.b0 * DEG, sb0 = Math.sin(b0), cb0 = Math.cos(b0);
  for (const s of sunspotsAt(jd)) {
    const B = s.lat * DEG, dl = (s.lon - phys.l0) * DEG;
    const sx = Math.cos(B) * Math.sin(dl), sy = Math.sin(B) * cb0 - Math.cos(B) * sb0 * Math.cos(dl);
    const mu = Math.sin(B) * sb0 + Math.cos(B) * cb0 * Math.cos(dl);
    if (mu < 0.06) continue; // خلف الحافة
    const px = x + R * (sx * Wx + sy * Nx), py = y + R * (sx * Wy + sy * Ny);
    const rad = Math.atan2(py - y, px - x); // اتجاه نصف القطر: الانكماش على هذا المحور
    const draw = (rr: number, col: string, edge: string) => {
      if (rr * R < 0.35) return;
      ctx.save(); ctx.translate(px, py); ctx.rotate(rad); ctx.scale(Math.max(0.12, mu), 1);
      const g = ctx.createRadialGradient(0, 0, rr * R * 0.55, 0, 0, rr * R);
      g.addColorStop(0, col); g.addColorStop(1, edge);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr * R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    };
    draw(s.pen, 'rgba(120,72,30,0.78)', 'rgba(120,72,30,0)');   // شبه الظل: قرص بني متدرج الحافة
    draw(s.umbra, 'rgba(18,9,4,0.96)', 'rgba(18,9,4,0.35)');     // الظل: نواة داكنة
  }
  // حدّ القرص الناعم
  ctx.restore();
}
