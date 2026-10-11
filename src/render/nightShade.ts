/**
 * تظليل الليل والشفق بشكل ناعم يصلح لأي تكبير.
 *
 * الطريقة القديمة (خلايا قطبية) تُظهر خطوط التقاء بين الخلايا وتتحول إلى مربعات كبيرة عند التقريب.
 * هنا يُحسب ارتفاع الشمس تحليلياً لكل بكسل في صورة صغيرة (512²) ثم تُرسم مكبَّرة بتمليس خطي:
 * الحقل أملس أصلاً (تدرّج الشفق عرضه ~18° ≈ 2000 كم) فلا تظهر أي حبيبات حتى عند 100x.
 *
 *   sin(alt) = sin(lat)·sin(δ) + cos(lat)·cos(δ)·cos(lon − lon☉)
 * بإحداثيات القرص: lat = 90° − 180°·r، وزاوية الاتجاه a = lon + GREENWICH_DOWN_OFFSET.
 */
import { GREENWICH_DOWN_OFFSET_DEG, type PolarMapConfig } from '../core/projection';

const N = 512;
const DEG = Math.PI / 180;

// (sin الارتفاع → شفافية الظلام): نهار، شروق/غروب، شفق مدني (−6°)، ملاحي (−12°)، فلكي (−18°)، ليل تام
const STOPS_SIN = [0.03, 0.0, -0.1045, -0.2079, -0.309, -0.4];
const STOPS_ALPHA = [0.0, 0.14, 0.4, 0.62, 0.74, 0.78];
const NIGHT_RGB = [3, 8, 28];

let off: HTMLCanvasElement | OffscreenCanvas | null = null;
let offCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
let image: ImageData | null = null;
let cosPR: Float32Array, sinPR: Float32Array, cosA: Float32Array, sinA: Float32Array;
let lastLat = NaN;
let lastLon = NaN;

function init(): void {
  off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : document.createElement('canvas');
  off.width = N;
  off.height = N;
  offCtx = off.getContext('2d') as CanvasRenderingContext2D;
  image = offCtx.createImageData(N, N);
  cosPR = new Float32Array(N * N);
  sinPR = new Float32Array(N * N);
  cosA = new Float32Array(N * N);
  sinA = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = ((i + 0.5) / N) * 2 - 1;
      const y = ((j + 0.5) / N) * 2 - 1;
      const r = Math.hypot(x, y);
      // خارج القرص نمدّد قيمة الحافة بدل التلاشي كي لا يظهر شريط فاتح عند الحافة بعد التكبير
      const pr = Math.PI * Math.min(r, 1);
      cosPR[k] = Math.cos(pr);
      sinPR[k] = Math.sin(pr);
      cosA[k] = -y / r; // cos(a) لأن y = −r·cos(a)
      sinA[k] = -x / r; // sin(a) لأن x = −r·sin(a)
    }
  }
  for (let k = 0; k < N * N; k++) {
    image.data[4 * k] = NIGHT_RGB[0];
    image.data[4 * k + 1] = NIGHT_RGB[1];
    image.data[4 * k + 2] = NIGHT_RGB[2];
  }
}

function alphaFor(s: number): number {
  if (s >= STOPS_SIN[0]) return 0;
  for (let i = 1; i < STOPS_SIN.length; i++) {
    if (s >= STOPS_SIN[i]) {
      const t = (STOPS_SIN[i - 1] - s) / (STOPS_SIN[i - 1] - STOPS_SIN[i]);
      return STOPS_ALPHA[i - 1] + t * (STOPS_ALPHA[i] - STOPS_ALPHA[i - 1]);
    }
  }
  return STOPS_ALPHA[STOPS_ALPHA.length - 1];
}

export function drawNightShadingSmooth(
  ctx: CanvasRenderingContext2D, subsolarLatDeg: number, subsolarLonDeg: number, config: PolarMapConfig
): void {
  if (!off) init();
  if (!image || !offCtx || !off) return;

  if (Math.abs(subsolarLatDeg - lastLat) > 1e-3 || Math.abs(subsolarLonDeg - lastLon) > 1e-3 || Number.isNaN(lastLat)) {
    const sinD = Math.sin(subsolarLatDeg * DEG);
    const cosD = Math.cos(subsolarLatDeg * DEG);
    const aS = (subsolarLonDeg + GREENWICH_DOWN_OFFSET_DEG) * DEG;
    const cAS = Math.cos(aS);
    const sAS = Math.sin(aS);
    const data = image.data;
    for (let k = 0; k < N * N; k++) {
      const sinAlt = cosPR[k] * sinD + sinPR[k] * cosD * (cosA[k] * cAS + sinA[k] * sAS);
      data[4 * k + 3] = Math.round(alphaFor(sinAlt) * 255);
    }
    offCtx.putImageData(image, 0, 0);
    lastLat = subsolarLatDeg;
    lastLon = subsolarLonDeg;
  }

  const R = config.outerRadiusPx;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off as CanvasImageSource, config.centerX - R, config.centerY - R, R * 2, R * 2);
  ctx.restore();
}
