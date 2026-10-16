import { useEffect, useRef, useState } from 'react';
import { useSimulationStore } from '../state/store';
import { lunarViewAt, type LunarView } from '../core/eclipses';
import { drawLunarView, setMoonTexture } from '../render/eclipseView';
import { getMoonImage, onBodyImageReady } from '../render/bodyImages';
import { resolveLook } from '../core/danjon';
import { useSettings } from '../settings';
import { useThrottled } from '../hooks';

/**
 * القمر بمحرّك الرسم نفسه المستخدم في المنظر المحلي للخسوف (eclipseView):
 * اتجاه سطحه الحقيقي مع التمايل، وإضاءة الطور، والهالة، ولون الخسوف تلقائياً متى وقع الخسوف.
 * خلفية شفافة بلا سماء ولا أفق، ومن غير غلاف جوي، فيُرى القمر دائماً حتى لو كان تحت الأفق.
 */

/** يطلب صورة القمر ويُعيد رقماً يتغيّر عند اكتمال تحميلها ليعاد الرسم */
export function useMoonTexture(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const apply = () => {
      const im = getMoonImage();
      if (im) { setMoonTexture(im); setTick((t) => t + 1); }
    };
    apply();
    return onBodyImageReady(apply);
  }, []);
  return tick;
}

export function MoonView({ date, size = 220, atmosphere = false }: { date: Date; size?: number; atmosphere?: boolean }) {
  const observer = useSimulationStore((s) => s.observer);
  const { eclipseLook } = useSettings();
  const d = useThrottled(date, 150);
  const tick = useMoonTexture();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = lunarViewAt(d, {
      latitudeDeg: observer.latitudeDeg, longitudeDeg: observer.longitudeDeg,
      elevationM: (observer as { elevationM?: number }).elevationM,
    });
    const look = resolveLook(d, eclipseLook);
    drawLunarView(ctx, size, size, v, { moonRadiusPx: size * 0.3, danjonL: look.L, tint: look.tint, bare: true, atmosphere });
  }, [d, tick, observer.latitudeDeg, observer.longitudeDeg, size, atmosphere, eclipseLook]);

  return <canvas ref={ref} className="moon-view" style={{ width: size, height: size }} />;
}

/** منظر قمر عام (لا مرتبط بتاريخ ولا موقع) لأيقونات الأطوار: اتجاه قياسي بلا تمايل، والشمس من الاستطالة */
function syntheticView(elongation: number): LunarView {
  const e = ((elongation % 360) + 360) % 360;
  const waxing = e <= 180;
  const phi = (waxing ? e : 360 - e) * (Math.PI / 180);
  return {
    moon: { altDeg: 45, azDeg: 180, radiusDeg: 0.26 },
    sun: { altDeg: -45, azDeg: 0, radiusDeg: 0.27 },
    shadow: { dx: 99, dy: 99, umbra: 2.6, penumbra: 4.6 },
    umbralMagnitude: -9,
    penumbralMagnitude: -9,
    phase: 'none',
    // x يميناً = شرق القمر، y = القطب، z نحو الراصد
    bodyToScreen: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    subObserver: { latDeg: 0, lonDeg: 0 },
    flatten: 1,
    sunDir: [(waxing ? 1 : -1) * Math.sin(phi), 0, -Math.cos(phi)],
  };
}

export function MoonPhaseIcon({ elongation, size = 28, southern = false }: { elongation: number; size?: number; southern?: boolean }) {
  const tick = useMoonTexture();
  const ref = useRef<HTMLCanvasElement>(null);
  const key = Math.round(elongation);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLunarView(ctx, size, size, syntheticView(key), { moonRadiusPx: size * 0.46, bare: true, atmosphere: false, halo: false });
  }, [key, size, tick]);
  return (
    <canvas ref={ref} className="moon-icon" style={{ width: size, height: size, transform: southern ? 'rotate(180deg)' : undefined }} />
  );
}
