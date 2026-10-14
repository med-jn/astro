import { useEffect, useRef, useState } from 'react';
import { shadeMoon, type DarkRegion } from '../core/moonShading';
import { simpleAppearance, type MoonAppearance } from '../core/lunar';
import { MOON_IMAGE_URL, MOON_IMAGE_ROTATION_CCW_DEG } from '../render/bodyImages';

/* ------------------------------------------------------------------ */
/*  النسيج: صورة القمر نفسها التي يرسمها الكانفاس                        */
/*  - تُدار 19° مع عقارب الساعة لتصحيح ميل الملف (MOON_IMAGE_ROTATION_CCW_DEG)   */
/*    فيصير قطب القمر الشمالي للأعلى وبحر الأزمات يميناً                       */
/*  - تُقصّ على حدود الجزء المعتم (الصورة بها هامش شفاف) وتُكبَّر 1.2% لإخفاء   */
/*    الحافة المسنّنة                                                          */
/* ------------------------------------------------------------------ */
let imagePromise: Promise<HTMLImageElement | null> | null = null;
const texCache = new Map<number, Uint8ClampedArray | null>();

function loadImage(): Promise<HTMLImageElement | null> {
  if (!imagePromise) {
    imagePromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = MOON_IMAGE_URL;
    });
  }
  return imagePromise;
}

async function loadTexture(N: number): Promise<Uint8ClampedArray | null> {
  if (texCache.has(N)) return texCache.get(N) ?? null;
  const img = await loadImage();
  if (!img) { texCache.set(N, null); return null; }
  try {
    // حدود الجزء المعتم
    const pw = Math.min(512, img.naturalWidth), ph = Math.min(512, img.naturalHeight);
    const probe = document.createElement('canvas');
    probe.width = pw; probe.height = ph;
    const pctx = probe.getContext('2d', { willReadFrequently: true })!;
    pctx.drawImage(img, 0, 0, pw, ph);
    const pd = pctx.getImageData(0, 0, pw, ph).data;
    let minX = pw, minY = ph, maxX = 0, maxY = 0, hasAlpha = false;
    for (let y = 0; y < ph; y++)
      for (let x = 0; x < pw; x++) {
        const a = pd[(y * pw + x) * 4 + 3];
        if (a < 250) hasAlpha = true;
        if (a > 128) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    const ok = hasAlpha && maxX > minX && maxY > minY;
    const sx = ok ? (minX / pw) * img.naturalWidth : 0;
    const sy = ok ? (minY / ph) * img.naturalHeight : 0;
    const sw = ok ? ((maxX - minX + 1) / pw) * img.naturalWidth : img.naturalWidth;
    const sh = ok ? ((maxY - minY + 1) / ph) * img.naturalHeight : img.naturalHeight;

    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(0, 0, N, N);
    ctx.translate(N / 2, N / 2);
    ctx.rotate((MOON_IMAGE_ROTATION_CCW_DEG * Math.PI) / 180);
    const zoom = 1.012;
    ctx.drawImage(img, sx, sy, sw, sh, (-N / 2) * zoom, (-N / 2) * zoom, N * zoom, N * zoom);
    const data = ctx.getImageData(0, 0, N, N).data;
    texCache.set(N, data);
    return data;
  } catch {
    texCache.set(N, null);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  التوهج: نفس منطق الكانفاس الرئيسي (drawMoon في skyRenderer)          */
/*  صفر قبل ثلاثة أيام من البدر، وذروته يوم الاكتمال                      */
/* ------------------------------------------------------------------ */
export function moonGlowK(sepDeg: number, haloScale = 1): number {
  const phaseAngle = 180 - sepDeg;
  const glow = phaseAngle >= 36.6 ? 0 : 0.5 * (1 + Math.cos((Math.PI * phaseAngle) / 36.6));
  return glow * haloScale;
}

function glowBackground(k: number, R: number, outer: number): string {
  const f0 = (0.9 * R) / outer;
  const at = (u: number) => `${((f0 + u * (1 - f0)) * 100).toFixed(1)}%`;
  return `radial-gradient(circle closest-side, rgba(245,249,255,${0.5 * k}) ${at(0)}, rgba(228,238,255,${0.4 * k}) ${at(0.1)}, rgba(205,221,255,${0.16 * k}) ${at(0.28)}, rgba(190,208,255,${0.045 * k}) ${at(0.6)}, rgba(190,208,255,0) 100%)`;
}

/* ------------------------------------------------------------------ */
/*  المكوّن                                                             */
/* ------------------------------------------------------------------ */
export function MoonCanvas({
  appearance,
  size = 160,
  glow = true,
  haloScale = 1,
  dark,
  label,
}: {
  appearance: MoonAppearance;
  size?: number;
  glow?: boolean;
  /** يُخفِت الإشعاع أثناء الخسوف */
  haloScale?: number;
  /** منطقة الإظلام بإطار الشمال السماوي (تُدار هنا إلى إطار قطب القمر) */
  dark?: DarkRegion;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(0);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const N = Math.max(24, Math.min(360, Math.round(size * dpr)));

  const { sepDeg, pa, q, poleAngle } = appearance;
  const k = glow ? moonGlowK(sepDeg, haloScale) : 0;

  // من إطار الشمال السماوي إلى إطار قطب القمر: دوران بزاوية P
  const P = poleAngle * (Math.PI / 180);
  const darkP: DarkRegion | undefined = dark && {
    ...dark,
    cx: dark.cx * Math.cos(P) + dark.cy * Math.sin(P),
    cy: -dark.cx * Math.sin(P) + dark.cy * Math.cos(P),
  };

  const key = [
    sepDeg.toFixed(1), (pa - poleAngle).toFixed(0), N, k.toFixed(2),
    darkP ? [darkP.cx, darkP.cy, darkP.coreR, darkP.haloR].map((v) => v.toFixed(2)).join(',') + (darkP.look?.id ?? '') : '',
  ].join('|');

  useEffect(() => {
    let live = true;
    loadTexture(N).then(() => live && setReady((v) => v + 1));
    return () => { live = false; };
  }, [N]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const tex = texCache.get(N) ?? null;
    const px = shadeMoon(tex, N, {
      sepDeg,
      pa: pa - poleAngle,
      dark: darkP,
      boost: k > 0.01 ? 0.34 * Math.pow(k, 4) : 0,
    });
    const img = ctx.createImageData(N, N);
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  const R = size / 2;
  const outer = R * (2.4 + 0.8 * k);
  return (
    <div className="moon-wrap" style={{ width: size, height: size }} role="img" aria-label={label}>
      {k > 0.01 && (
        <span className="moon-glow" style={{ width: outer * 2, height: outer * 2, background: glowBackground(k, R, outer) }} aria-hidden />
      )}
      {/* القطب → الأفق: تدوير مع عقارب الساعة بمقدار (الزاوية المتوازية − زاوية القطب) */}
      <canvas ref={ref} style={{ width: size, height: size, transform: `rotate(${(q - poleAngle).toFixed(1)}deg)` }} />
    </div>
  );
}

/** قرص صغير من الاستطالة وحدها (للأيقونات وشرائط الأطوار). */
export function MoonDisc({
  elongation, size = 28, southern = false, label,
}: { elongation: number; size?: number; southern?: boolean; label?: string }) {
  return <MoonCanvas appearance={simpleAppearance(elongation, southern)} size={size} glow={false} label={label} />;
}
