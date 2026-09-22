import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useSimulationStore, SECONDS_PER_DAY } from '../state/store';
import { renderSky, type RenderOutput, type HitTarget } from '../render/skyRenderer';
import { computeOuterRadiusPx } from '../core/projection';

interface Props {
  onFrame?: (output: RenderOutput) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const HIT_RADIUS_PX = 14;
const EDGE_BAND_FRACTION = 0.78;
const TAP_MAX_DURATION_MS = 350;
const TAP_MAX_MOVEMENT_PX = 6;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function SkyCanvas({ onFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimestampRef = useRef<number>(0);
  const hitTargetsRef = useRef<HitTarget[]>([]);

  const pendingRotationDeltaRef = useRef(0);
  const pendingZoomFactorRef = useRef(1);
  const pendingPanDeltaRef = useRef({ x: 0, y: 0 });
  const pendingTimeDragDeltaDegRef = useRef(0);

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
      if (pendingPanDeltaRef.current.x !== 0 || pendingPanDeltaRef.current.y !== 0) {
        flushState = useSimulationStore.getState();
        flushState.setPan(pendingPanDeltaRef.current.x, pendingPanDeltaRef.current.y);
        pendingPanDeltaRef.current = { x: 0, y: 0 };
      }
      if (pendingTimeDragDeltaDegRef.current !== 0) {
        flushState = useSimulationStore.getState();
        const addedMs = (pendingTimeDragDeltaDegRef.current / 360) * SECONDS_PER_DAY * 1000;
        flushState.setDate(new Date(flushState.date.getTime() + addedMs));
        pendingTimeDragDeltaDegRef.current = 0;
      }

      const state = useSimulationStore.getState();
      if (state.customTimeRateDegPerSec !== null) {
        const simSecondsPerRealSecond = (state.customTimeRateDegPerSec / 360) * SECONDS_PER_DAY;
        state.setDate(new Date(state.date.getTime() + simSecondsPerRealSecond * deltaSeconds * 1000));
      } else if (state.isPlaying) {
        state.stepTime(deltaSeconds);
      }

      const rect = canvas!.getBoundingClientRect();
      const currentState = useSimulationStore.getState();
      const output = renderSky(ctx!, rect.width, rect.height, {
        date: currentState.date,
        observer: currentState.observer,
        zoomScale: currentState.zoomScale,
        layers: currentState.layers,
        selectedZodiacs: currentState.selectedZodiacs,
        selectedMansionIndices: currentState.selectedMansionIndices,
        calibration: currentState.calibration,
        sceneRotationDeg: currentState.sceneRotationDeg,
        panX: currentState.panX,
        panY: currentState.panY,
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
    let singleDragMode: 'edge' | 'inside' | null = null;
    let lastAngleDeg = 0;
    let velocitySamples: { angleDeg: number; t: number }[] = [];
    let dragStartTime = 0;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragTotalMovementPx = 0;
    let lastPinchDist = 0;
    let lastMidpoint = { x: 0, y: 0 };
    let rightButtonPanning = false;

    function angleFromCenterDeg(clientX: number, clientY: number): number {
      const rect = canvas!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.atan2(clientX - cx, -(clientY - cy)) * (180 / Math.PI);
    }

    function distanceFromCenterPx(clientX: number, clientY: number): number {
      const rect = canvas!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.hypot(clientX - cx, clientY - cy);
    }

    function currentOuterRadiusPx(): number {
      const rect = canvas!.getBoundingClientRect();
      return computeOuterRadiusPx(rect.width, rect.height, useSimulationStore.getState().zoomScale);
    }

    function pinchDistance(): number {
      const pts = [...activePointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    function pinchMidpoint(): { x: number; y: number } {
      const pts = [...activePointers.values()];
      if (pts.length < 2) return { x: 0, y: 0 };
      return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }

    function findNearestTarget(clientX: number, clientY: number): HitTarget | null {
      const rect = canvas!.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      let nearest: HitTarget | null = null;
      let nearestDist = HIT_RADIUS_PX;
      for (const t of hitTargetsRef.current) {
        const d = Math.hypot(t.x - localX, t.y - localY);
        if (d < nearestDist) { nearest = t; nearestDist = d; }
      }
      return nearest;
    }

    function beginSingleDrag(clientX: number, clientY: number) {
      const dist = distanceFromCenterPx(clientX, clientY);
      const radius = currentOuterRadiusPx();
      singleDragMode = dist >= radius * EDGE_BAND_FRACTION ? 'edge' : 'inside';
      lastAngleDeg = angleFromCenterDeg(clientX, clientY);
      dragStartTime = performance.now();
      dragStartClientX = clientX;
      dragStartClientY = clientY;
      dragTotalMovementPx = 0;
      velocitySamples = [{ angleDeg: lastAngleDeg, t: dragStartTime }];
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (e.pointerType !== 'mouse') setTooltip(findNearestTarget(e.clientX, e.clientY));

      if (e.button === 2) {
        rightButtonPanning = true;
        lastMidpoint = { x: e.clientX, y: e.clientY };
        return;
      }

      if (activePointers.size === 1 && useSimulationStore.getState().customTimeRateDegPerSec !== null) {
        useSimulationStore.getState().setCustomTimeRate(null);
      }

      if (activePointers.size === 1) {
        beginSingleDrag(e.clientX, e.clientY);
      } else if (activePointers.size === 2) {
        singleDragMode = null;
        lastPinchDist = pinchDistance();
        lastMidpoint = pinchMidpoint();
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (rightButtonPanning) {
        const rect = canvas!.getBoundingClientRect();
        const radius = computeOuterRadiusPx(rect.width, rect.height, useSimulationStore.getState().zoomScale);
        pendingPanDeltaRef.current.x += (e.clientX - lastMidpoint.x) / radius;
        pendingPanDeltaRef.current.y += (e.clientY - lastMidpoint.y) / radius;
        lastMidpoint = { x: e.clientX, y: e.clientY };
        return;
      }

      if (!activePointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') setTooltip(findNearestTarget(e.clientX, e.clientY));
        return;
      }

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size >= 2) {
        const dist = pinchDistance();
        if (lastPinchDist > 0 && dist > 0) pendingZoomFactorRef.current *= dist / lastPinchDist;
        lastPinchDist = dist;

        const mid = pinchMidpoint();
        const rect = canvas!.getBoundingClientRect();
        const radius = computeOuterRadiusPx(rect.width, rect.height, useSimulationStore.getState().zoomScale);
        pendingPanDeltaRef.current.x += (mid.x - lastMidpoint.x) / radius;
        pendingPanDeltaRef.current.y += (mid.y - lastMidpoint.y) / radius;
        lastMidpoint = mid;
        return;
      }

      dragTotalMovementPx = Math.hypot(e.clientX - dragStartClientX, e.clientY - dragStartClientY);

      if (singleDragMode === 'edge') {
        const angle = angleFromCenterDeg(e.clientX, e.clientY);
        let delta = angle - lastAngleDeg;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        lastAngleDeg = angle;
        pendingRotationDeltaRef.current += delta;
      } else if (singleDragMode === 'inside') {
        const angle = angleFromCenterDeg(e.clientX, e.clientY);
        let delta = angle - lastAngleDeg;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        lastAngleDeg = angle;
        pendingTimeDragDeltaDegRef.current += delta;

        const now = performance.now();
        const prevCumulative = velocitySamples[velocitySamples.length - 1].angleDeg;
        velocitySamples.push({ angleDeg: prevCumulative + delta, t: now });
        if (velocitySamples.length > 2) velocitySamples.shift();
      }
    }

    function onPointerUp(e: PointerEvent) {
      try { canvas!.releasePointerCapture(e.pointerId); } catch { /* تجاهل */ }
      if (e.button === 2) rightButtonPanning = false;

      activePointers.delete(e.pointerId);
      if (e.pointerType !== 'mouse') setTooltip(null);

      if (singleDragMode === 'inside') {
        const durationMs = performance.now() - dragStartTime;
        const isTap = durationMs < TAP_MAX_DURATION_MS && dragTotalMovementPx < TAP_MAX_MOVEMENT_PX;

        if (isTap) {
          const s = useSimulationStore.getState();
          if (s.customTimeRateDegPerSec !== null) s.setCustomTimeRate(null);
          else if (s.isPlaying) s.togglePlay();
        } else if (velocitySamples.length >= 2) {
          const a = velocitySamples[0];
          const b = velocitySamples[velocitySamples.length - 1];
          const dtSec = (b.t - a.t) / 1000;
          if (dtSec > 0.01) {
            const releaseVelocityDegPerSec = (b.angleDeg - a.angleDeg) / dtSec;
            useSimulationStore.getState().setCustomTimeRate(releaseVelocityDegPerSec);
          }
        }
      }

      singleDragMode = null;

      if (activePointers.size === 1) {
        const [remaining] = activePointers.values();
        beginSingleDrag(remaining.x, remaining.y);
        lastPinchDist = 0;
      } else if (activePointers.size === 0) {
        lastPinchDist = 0;
      }
    }

    function onPointerLeave() { setTooltip(null); }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      pendingZoomFactorRef.current *= e.deltaY > 0 ? 0.9 : 1.1;
    }

    function onContextMenu(e: MouseEvent) { e.preventDefault(); }

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      switch (e.key) {
        case 'ArrowLeft': pendingRotationDeltaRef.current -= 3; break;
        case 'ArrowRight': pendingRotationDeltaRef.current += 3; break;
        case 'ArrowUp': case '+': case '=': pendingZoomFactorRef.current *= 1.08; break;
        case 'ArrowDown': case '-': pendingZoomFactorRef.current *= 0.92; break;
        default: return;
      }
      e.preventDefault();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function playAudio(url: string) {
    try { new Audio(url).play().catch(() => {}); } catch { /* تجاهل */ }
  }

  return (
    <div className="sky-canvas-wrap">
      <canvas ref={canvasRef} className="sky-canvas" tabIndex={0} />
      {tooltip && (
        <div className="hover-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="hover-tooltip-row">
            <span className="hover-tooltip-name">{tooltip.name}</span>
            {tooltip.audioUrl && (
              <button className="hover-tooltip-audio-btn" onClick={() => playAudio(tooltip.audioUrl!)} title="استماع">
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
