import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useSimulationStore } from '../state/store';
import { renderSky, type RenderOutput, type HitTarget } from '../render/skyRenderer';

interface Props {
  onFrame?: (output: RenderOutput) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const HIT_RADIUS_PX = 14;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function SkyCanvas({ onFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimestampRef = useRef<number>(0);
  const hitTargetsRef = useRef<HitTarget[]>([]);

  // تُراكم هنا أي تغييرات دوران/تكبير أثناء الإطار الحالي، وتُطبَّق دفعة واحدة فقط في بداية
  // كل إطار رسم (بدل استدعاء المتجر عند كل حدث pointermove خام، الذي قد يصل 100+ مرة/ثانية
  // ويُثقل الرسم بإعادة رسم لوحة التحكم بشكل متكرر جداً — هذا كان السبب الرئيسي للتقطيع).
  const pendingRotationDeltaRef = useRef(0);
  const pendingZoomFactorRef = useRef(1);

  const [tooltip, setTooltip] = useState<HitTarget | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function loop(timestamp: number) {
      if (!lastTimestampRef.current) lastTimestampRef.current = timestamp;
      const deltaSeconds = (timestamp - lastTimestampRef.current) / 1000;
      lastTimestampRef.current = timestamp;

      // تطبيق أي دوران/تكبير مُراكَم من السحب هذا الإطار فقط — مرة واحدة، وليس عند كل حدث
      let flushState = useSimulationStore.getState();
      if (pendingRotationDeltaRef.current !== 0) {
        flushState.setSceneRotation(flushState.sceneRotationDeg + pendingRotationDeltaRef.current);
        pendingRotationDeltaRef.current = 0;
      }
      if (pendingZoomFactorRef.current !== 1) {
        flushState = useSimulationStore.getState();
        flushState.setZoom(clampZoom(flushState.zoomScale * pendingZoomFactorRef.current));
        pendingZoomFactorRef.current = 1;
      }

      const state = useSimulationStore.getState();
      if (state.isPlaying) {
        state.stepTime(deltaSeconds);
      }

      const rect = canvas!.getBoundingClientRect();
      const currentState = useSimulationStore.getState();
      const output = renderSky(ctx!, rect.width, rect.height, {
        date: currentState.date,
        observer: currentState.observer,
        zoomScale: currentState.zoomScale,
        layers: currentState.layers,
        isolatedZodiac: currentState.isolatedZodiac,
        calibration: currentState.calibration,
        sceneRotationDeg: currentState.sceneRotationDeg,
      });
      hitTargetsRef.current = output.hitTargets;
      onFrame?.(output);

      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const activePointers = new Map<number, { x: number; y: number }>();
    let rotating = false;
    let lastAngleDeg = 0;
    let lastPinchDist = 0;

    function angleFromCenterDeg(clientX: number, clientY: number): number {
      const rect = canvas!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      return Math.atan2(dx, -dy) * (180 / Math.PI);
    }

    function pinchDistance(): number {
      const pts = [...activePointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    function findNearestTarget(clientX: number, clientY: number): HitTarget | null {
      const rect = canvas!.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      let nearest: HitTarget | null = null;
      let nearestDist = HIT_RADIUS_PX;
      for (const t of hitTargetsRef.current) {
        const d = Math.hypot(t.x - localX, t.y - localY);
        if (d < nearestDist) {
          nearest = t;
          nearestDist = d;
        }
      }
      return nearest;
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (e.pointerType !== 'mouse') {
        setTooltip(findNearestTarget(e.clientX, e.clientY));
      }

      if (activePointers.size === 1) {
        rotating = true;
        lastAngleDeg = angleFromCenterDeg(e.clientX, e.clientY);
      } else if (activePointers.size === 2) {
        rotating = false;
        lastPinchDist = pinchDistance();
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!activePointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          setTooltip(findNearestTarget(e.clientX, e.clientY));
        }
        return;
      }

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size >= 2) {
        const dist = pinchDistance();
        if (lastPinchDist > 0 && dist > 0) {
          pendingZoomFactorRef.current *= dist / lastPinchDist;
        }
        lastPinchDist = dist;
      } else if (rotating) {
        const angle = angleFromCenterDeg(e.clientX, e.clientY);
        let delta = angle - lastAngleDeg;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        lastAngleDeg = angle;
        pendingRotationDeltaRef.current += delta;
      }
    }

    function onPointerUp(e: PointerEvent) {
      try { canvas!.releasePointerCapture(e.pointerId); } catch { /* تجاهل */ }
      activePointers.delete(e.pointerId);
      if (e.pointerType !== 'mouse') setTooltip(null);

      if (activePointers.size === 1) {
        const [remaining] = activePointers.values();
        rotating = true;
        lastAngleDeg = angleFromCenterDeg(remaining.x, remaining.y);
        lastPinchDist = 0;
      } else if (activePointers.size === 0) {
        rotating = false;
        lastPinchDist = 0;
      }
    }

    function onPointerLeave() {
      setTooltip(null);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      pendingZoomFactorRef.current *= factor;
    }

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      switch (e.key) {
        case 'ArrowLeft':
          pendingRotationDeltaRef.current -= 3;
          break;
        case 'ArrowRight':
          pendingRotationDeltaRef.current += 3;
          break;
        case 'ArrowUp':
        case '+':
        case '=':
          pendingZoomFactorRef.current *= 1.08;
          break;
        case 'ArrowDown':
        case '-':
          pendingZoomFactorRef.current *= 0.92;
          break;
        default:
          return;
      }
      e.preventDefault();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function playAudio(url: string) {
    try {
      new Audio(url).play().catch(() => { /* تجاهل فشل التشغيل (مثلاً ملف غير موجود بعد) */ });
    } catch { /* تجاهل */ }
  }

  return (
    <div className="sky-canvas-wrap">
      <canvas ref={canvasRef} className="sky-canvas" tabIndex={0} />
      {tooltip && (
        <div className="hover-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="hover-tooltip-row">
            <span className="hover-tooltip-name">{tooltip.name}</span>
            {tooltip.audioUrl && (
              <button
                className="hover-tooltip-audio-btn"
                onClick={() => playAudio(tooltip.audioUrl!)}
                title="استماع"
              >
                <Volume2 size={12} />
              </button>
            )}
          </div>
          <div className="hover-tooltip-detail">{tooltip.detail}</div>
          {tooltip.description && <div className="hover-tooltip-desc">{tooltip.description}</div>}
        </div>
      )}
    </div>
  );
}