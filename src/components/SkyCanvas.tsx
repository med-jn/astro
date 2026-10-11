import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Volume2, Hand, Clock, LocateFixed } from 'lucide-react';
import { useSimulationStore, SECONDS_PER_DAY } from '../state/store';
import { renderSky, type RenderOutput, type HitTarget } from '../render/skyRenderer';
import { computeOuterRadiusPx } from '../core/projection';

interface Props {
  onFrame?: (output: RenderOutput) => void;
}

const HIT_RADIUS_PX = 14;
/** حلقة الحافة التي يدوّر السحب عليها المشهد: في وضع تحريك الخريطة ضيقة (الحافة فقط) كي لا
 *  تتعارض مع الإمساك بالخريطة، وفي وضع الزمن تبقى بعرضها القديم تماماً. */
const EDGE_BAND_PAN_MODE = 0.9;
const EDGE_BAND_TIME_MODE = 0.78;
const TAP_MAX_DURATION_MS = 350;
const TAP_MAX_MOVEMENT_PX = 6;
/** سرعة التحريك بالأسهم المضغوطة: نسبة من أصغر بُعد للكانفس في الثانية (مستقلة عن التكبير) */
const KEY_PAN_VIEWPORT_PER_SEC = 0.55;
const KEY_ROTATE_STEP_DEG = 3;
const KEY_ZOOM_IN = 1.08;
const KEY_ZOOM_OUT = 0.92;
const PAN_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

type DragMode = 'pan' | 'time' | 'rotate';

const TOOLBAR_STYLE: CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  display: 'flex',
  gap: 8,
  zIndex: 5,
};

function toolButtonStyle(active: boolean): CSSProperties {
  return {
    width: 40,
    height: 40,
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    borderRadius: 10,
    cursor: 'pointer',
    color: active ? '#d4b688' : '#cbd5e1',
    background: active ? 'rgba(176, 141, 87, 0.22)' : 'rgba(10, 14, 22, 0.82)',
    border: `1px solid ${active ? '#b08d57' : 'rgba(226, 232, 240, 0.18)'}`,
    backdropFilter: 'blur(6px)',
  };
}

export function SkyCanvas({ onFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimestampRef = useRef<number>(0);
  const hitTargetsRef = useRef<HitTarget[]>([]);

  const pendingRotationDeltaRef = useRef(0);
  const pendingZoomFactorRef = useRef(1);
  /** نقطة تثبيت التكبير بالبكسل نسبةً لمركز الكانفس (المؤشر أو منتصف الإصبعين) */
  const pendingZoomAnchorRef = useRef({ x: 0, y: 0 });
  /** إزاحة معلّقة بالبكسل (لا بنسبة نصف القطر) تُحوَّل عند التطبيق بعد التكبير */
  const pendingPanPxRef = useRef({ x: 0, y: 0 });
  const pendingTimeDragDeltaDegRef = useRef(0);
  const heldPanKeysRef = useRef(new Set<string>());

  const [tooltip, setTooltip] = useState<HitTarget | null>(null);
  /** false = السحب بإصبع/زر أيسر يحرّك الخريطة (الافتراضي)، true = يحرّك الزمن (السلوك القديم) */
  const [timeMode, setTimeMode] = useState(false);
  const timeModeRef = useRef(false);
  timeModeRef.current = timeMode;

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
      // يُحدَّث فقط هنا (التركيب/تغيير الحجم) لا كل إطار — تستخدمه ميزة توسيط نتائج البحث
      useSimulationStore.getState().setViewportSize(rect.width, rect.height);
    }
    resize();
    window.addEventListener('resize', resize);

    function keyPanDirection(): { x: number; y: number } {
      const k = heldPanKeysRef.current;
      // اتجاه حركة "الكاميرا": السهم الأيسر ينقل العرض يساراً، أي أن الخريطة تنزاح يميناً
      let x = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
      let y = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
      if (x !== 0 && y !== 0) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      return { x, y };
    }

    function loop(timestamp: number) {
      if (!lastTimestampRef.current) lastTimestampRef.current = timestamp;
      const deltaSeconds = (timestamp - lastTimestampRef.current) / 1000;
      lastTimestampRef.current = timestamp;

      let flushState = useSimulationStore.getState();
      if (pendingRotationDeltaRef.current !== 0) {
        flushState.setSceneRotation(flushState.sceneRotationDeg + pendingRotationDeltaRef.current);
        pendingRotationDeltaRef.current = 0;
      }

      const dir = keyPanDirection();
      if (dir.x !== 0 || dir.y !== 0) {
        const r = canvas!.getBoundingClientRect();
        const step = Math.min(r.width, r.height) * KEY_PAN_VIEWPORT_PER_SEC * Math.min(deltaSeconds, 0.1);
        pendingPanPxRef.current.x += dir.x * step;
        pendingPanPxRef.current.y += dir.y * step;
      }

      // الترتيب مهم: التكبير (مع تثبيت النقطة) أولاً، ثم الإزاحة بالبكسل بنصف القطر الجديد
      if (pendingZoomFactorRef.current !== 1) {
        flushState = useSimulationStore.getState();
        const r = canvas!.getBoundingClientRect();
        const radius = computeOuterRadiusPx(r.width, r.height, flushState.zoomScale);
        flushState.zoomAt(
          pendingZoomFactorRef.current,
          pendingZoomAnchorRef.current.x / radius,
          pendingZoomAnchorRef.current.y / radius
        );
        pendingZoomFactorRef.current = 1;
      }
      if (pendingPanPxRef.current.x !== 0 || pendingPanPxRef.current.y !== 0) {
        flushState = useSimulationStore.getState();
        const r = canvas!.getBoundingClientRect();
        const radius = computeOuterRadiusPx(r.width, r.height, flushState.zoomScale);
        flushState.setPan(pendingPanPxRef.current.x / radius, pendingPanPxRef.current.y / radius);
        pendingPanPxRef.current = { x: 0, y: 0 };
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
        selectedGroupIds: currentState.selectedGroupIds,
        highlightedStarId: currentState.highlightedStarId,
        timeZoneKind: currentState.timeZoneKind,
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
    let singleDragMode: DragMode | null = null;
    let tapEligible = false;
    let lastAngleDeg = 0;
    let velocitySamples: { angleDeg: number; t: number }[] = [];
    let dragStartTime = 0;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragTotalMovementPx = 0;
    let lastPinchDist = 0;
    let lastMidpoint = { x: 0, y: 0 };

    /** مركز القرص (القطب الشمالي) على الشاشة ونصف قطره — يتبع الإزاحة. كل من التدوير وتحريك
     *  الزمن يدور حول القطب، لذا تُقاس زواياه من هذه النقطة لا من مركز الكانفس. */
    function discGeometry() {
      const rect = canvas!.getBoundingClientRect();
      const s = useSimulationStore.getState();
      const radius = computeOuterRadiusPx(rect.width, rect.height, s.zoomScale);
      return {
        cx: rect.left + rect.width / 2 + s.panX * radius,
        cy: rect.top + rect.height / 2 + s.panY * radius,
        radius,
      };
    }

    function angleFromDiscCenterDeg(clientX: number, clientY: number): number {
      const { cx, cy } = discGeometry();
      return Math.atan2(clientX - cx, -(clientY - cy)) * (180 / Math.PI);
    }

    function offsetFromCanvasCenter(clientX: number, clientY: number) {
      const rect = canvas!.getBoundingClientRect();
      return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
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

    /**
     * يحدّد وظيفة السحب بإصبع/مؤشر واحد:
     *  - زر الفأرة الأيمن  → تحريك الزمن دائماً
     *  - Shift + سحب أيسر  → تدوير المشهد (للوصول إليه عند التكبير حين تخرج الحافة من الشاشة)
     *  - البدء على حلقة الحافة → تدوير المشهد
     *  - غير ذلك → تحريك الخريطة، أو تحريك الزمن إن كان وضع الزمن مفعّلاً
     */
    function beginSingleDrag(clientX: number, clientY: number, opts: { forceTime?: boolean; forceRotate?: boolean } = {}) {
      const { cx, cy, radius } = discGeometry();
      const dist = Math.hypot(clientX - cx, clientY - cy);
      const wantsTime = !!opts.forceTime || timeModeRef.current;
      const band = wantsTime ? EDGE_BAND_TIME_MODE : EDGE_BAND_PAN_MODE;

      if (opts.forceTime) singleDragMode = 'time';
      else if (opts.forceRotate || dist >= radius * band) singleDragMode = 'rotate';
      else singleDragMode = wantsTime ? 'time' : 'pan';

      tapEligible = !opts.forceTime && !opts.forceRotate && singleDragMode !== 'rotate';
      lastAngleDeg = angleFromDiscCenterDeg(clientX, clientY);
      dragStartTime = performance.now();
      dragStartClientX = clientX;
      dragStartClientY = clientY;
      dragTotalMovementPx = 0;
      velocitySamples = [{ angleDeg: lastAngleDeg, t: dragStartTime }];
      canvas!.style.cursor = 'grabbing';
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return; // تجاهل الزر الأوسط
      canvas!.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (e.pointerType !== 'mouse') setTooltip(findNearestTarget(e.clientX, e.clientY));

      if (activePointers.size === 1 && useSimulationStore.getState().customTimeRateDegPerSec !== null) {
        useSimulationStore.getState().setCustomTimeRate(null);
      }

      if (activePointers.size === 1) {
        beginSingleDrag(e.clientX, e.clientY, {
          forceTime: e.pointerType === 'mouse' && e.button === 2,
          forceRotate: e.pointerType === 'mouse' && e.button === 0 && e.shiftKey,
        });
      } else if (activePointers.size === 2) {
        singleDragMode = null;
        tapEligible = false;
        lastPinchDist = pinchDistance();
        lastMidpoint = pinchMidpoint();
      }
    }

    function onPointerMove(e: PointerEvent) {
      const prev = activePointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') setTooltip(findNearestTarget(e.clientX, e.clientY));
        return;
      }
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size >= 2) {
        // قرص الإصبعين: تكبير مع تثبيت النقطة بين الإصبعين + تحريك الخريطة بحركة المنتصف
        const dist = pinchDistance();
        const mid = pinchMidpoint();
        if (lastPinchDist > 0 && dist > 0) {
          pendingZoomFactorRef.current *= dist / lastPinchDist;
          pendingZoomAnchorRef.current = offsetFromCanvasCenter(mid.x, mid.y);
        }
        lastPinchDist = dist;
        pendingPanPxRef.current.x += mid.x - lastMidpoint.x;
        pendingPanPxRef.current.y += mid.y - lastMidpoint.y;
        lastMidpoint = mid;
        return;
      }

      dragTotalMovementPx = Math.hypot(e.clientX - dragStartClientX, e.clientY - dragStartClientY);

      if (singleDragMode === 'pan') {
        pendingPanPxRef.current.x += e.clientX - prev.x;
        pendingPanPxRef.current.y += e.clientY - prev.y;
      } else if (singleDragMode === 'rotate') {
        const angle = angleFromDiscCenterDeg(e.clientX, e.clientY);
        let delta = angle - lastAngleDeg;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        lastAngleDeg = angle;
        pendingRotationDeltaRef.current += delta;
      } else if (singleDragMode === 'time') {
        const angle = angleFromDiscCenterDeg(e.clientX, e.clientY);
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

      activePointers.delete(e.pointerId);
      if (e.pointerType !== 'mouse') setTooltip(null);
      canvas!.style.cursor = 'grab';

      if (singleDragMode === 'pan' || singleDragMode === 'time') {
        const durationMs = performance.now() - dragStartTime;
        const isTap = tapEligible && durationMs < TAP_MAX_DURATION_MS && dragTotalMovementPx < TAP_MAX_MOVEMENT_PX;

        if (isTap) {
          const s = useSimulationStore.getState();
          if (s.customTimeRateDegPerSec !== null) s.setCustomTimeRate(null);
          else if (s.isPlaying) s.togglePlay();
        } else if (singleDragMode === 'time' && velocitySamples.length >= 2) {
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
        // رُفع أحد الإصبعين: يكمل الآخر كسحب عادي، لكن دون أن تُحسب النقرة (تبديل التشغيل)
        const [remaining] = activePointers.values();
        beginSingleDrag(remaining.x, remaining.y);
        tapEligible = false;
        lastPinchDist = 0;
      } else if (activePointers.size === 0) {
        lastPinchDist = 0;
      }
    }

    function onPointerLeave() { setTooltip(null); }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      // دلتا مُطبَّعة (عجلة الفأرة بالأسطر/لوحة اللمس بالبكسل) وتكبير أسّي ناعم نحو المؤشر
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const delta = Math.max(-300, Math.min(300, e.deltaY * unit));
      pendingZoomFactorRef.current *= Math.exp(-delta * 0.001);
      pendingZoomAnchorRef.current = offsetFromCanvasCenter(e.clientX, e.clientY);
    }

    function onContextMenu(e: MouseEvent) { e.preventDefault(); }

    function isTypingTarget(e: KeyboardEvent): boolean {
      const target = e.target as HTMLElement | null;
      return !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e)) return;

      // الأسهم وحدها: تحريك الخريطة (مستمر وسلس أثناء الضغط)
      if (PAN_KEYS.includes(e.key) && !e.shiftKey) {
        heldPanKeysRef.current.add(e.key);
        e.preventDefault();
        return;
      }

      // Shift + الأسهم: السلوك القديم كما كان (يسار/يمين = تدوير، فوق/تحت = تكبير)
      switch (e.key) {
        case 'ArrowLeft': pendingRotationDeltaRef.current -= KEY_ROTATE_STEP_DEG; break;
        case 'ArrowRight': pendingRotationDeltaRef.current += KEY_ROTATE_STEP_DEG; break;
        case 'ArrowUp': case '+': case '=':
          pendingZoomFactorRef.current *= KEY_ZOOM_IN;
          pendingZoomAnchorRef.current = { x: 0, y: 0 };
          break;
        case 'ArrowDown': case '-': case '_':
          pendingZoomFactorRef.current *= KEY_ZOOM_OUT;
          pendingZoomAnchorRef.current = { x: 0, y: 0 };
          break;
        default: return;
      }
      e.preventDefault();
    }

    function onKeyUp(e: KeyboardEvent) { heldPanKeysRef.current.delete(e.key); }
    function onBlur() { heldPanKeysRef.current.clear(); }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  function playAudio(url: string) {
    try { new Audio(url).play().catch(() => {}); } catch { /* تجاهل */ }
  }

  function recenterView() {
    const s = useSimulationStore.getState();
    s.resetPan();
    s.setZoom(1);
  }

  return (
    <div className="sky-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="sky-canvas"
        tabIndex={0}
        style={{ touchAction: 'none', cursor: 'grab' }}
      />

      <div style={TOOLBAR_STYLE}>
        <button
          type="button"
          style={toolButtonStyle(timeMode)}
          aria-pressed={timeMode}
          title={
            timeMode
              ? 'السحب الآن يحرّك الزمن — اضغط للعودة إلى تحريك الخريطة'
              : 'السحب الآن يحرّك الخريطة — اضغط للتبديل إلى تحريك الزمن'
          }
          onClick={() => setTimeMode((v) => !v)}
        >
          {timeMode ? <Clock size={18} /> : <Hand size={18} />}
        </button>
        <button
          type="button"
          style={toolButtonStyle(false)}
          title="إعادة العرض إلى المركز (يحفظ التدوير والزمن)"
          onClick={recenterView}
        >
          <LocateFixed size={18} />
        </button>
      </div>

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
