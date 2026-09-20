import { useRef, useState } from 'react';
import { X, Check, RotateCcw, Copy, ClipboardCheck } from 'lucide-react';
import { useSimulationStore } from '../state/store';
import { exportCalibrationAsCode, type PixelPoint, type MapCalibration } from '../core/mapCalibration';

type StepKey = 'poleP' | 'cancerP' | 'equatorP' | 'capricornP' | 'greenwichP';

const STEPS: { key: StepKey; title: string; hint: string; color: string }[] = [
  { key: 'poleP', title: 'القطب الشمالي', hint: 'انقر على مركز القطب الشمالي في الصورة (نقطة واحدة تماماً)', color: '#38bdf8' },
  { key: 'cancerP', title: 'مدار السرطان', hint: 'انقر أي نقطة تقع بالضبط على خط مدار السرطان', color: '#facc15' },
  { key: 'equatorP', title: 'خط الاستواء', hint: 'انقر أي نقطة تقع بالضبط على خط الاستواء', color: '#4ade80' },
  { key: 'capricornP', title: 'مدار الجدي', hint: 'انقر أي نقطة تقع بالضبط على خط مدار الجدي', color: '#fb923c' },
  { key: 'greenwichP', title: 'خط غرينتش', hint: 'انقر أي نقطة تقع على خط طول غرينتش (0°) بين القطب والحافة', color: '#f472b6' },
];

const IMAGE_SRC = `${import.meta.env.BASE_URL}images/earth.jpeg`;

export function MapCalibrator() {
  const cancelCalibrating = useSimulationStore((s) => s.cancelCalibrating);
  const finishCalibrating = useSimulationStore((s) => s.finishCalibrating);
  const existing = useSimulationStore((s) => s.calibration);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [points, setPoints] = useState<Partial<Record<StepKey, PixelPoint>>>({});
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [copied, setCopied] = useState(false);

  const currentStep = STEPS[stepIndex];
  const done = stepIndex >= STEPS.length;

  function handleImageLoad() {
    const img = imgRef.current;
    if (img) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (done) return;
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || naturalSize.w === 0) return;

    const containerRect = container.getBoundingClientRect();
    const scale = Math.min(containerRect.width / naturalSize.w, containerRect.height / naturalSize.h);
    const displayedW = naturalSize.w * scale;
    const displayedH = naturalSize.h * scale;
    const offsetX = (containerRect.width - displayedW) / 2;
    const offsetY = (containerRect.height - displayedH) / 2;

    const clickX = e.clientX - containerRect.left - offsetX;
    const clickY = e.clientY - containerRect.top - offsetY;
    if (clickX < 0 || clickY < 0 || clickX > displayedW || clickY > displayedH) return;

    const naturalX = clickX / scale;
    const naturalY = clickY / scale;

    setPoints((p) => ({ ...p, [currentStep.key]: { x: naturalX, y: naturalY } }));
    setStepIndex((i) => i + 1);
  }

  function toDisplayPoint(p: PixelPoint) {
    const container = containerRef.current;
    if (!container || naturalSize.w === 0) return { x: 0, y: 0 };
    const containerRect = container.getBoundingClientRect();
    const scale = Math.min(containerRect.width / naturalSize.w, containerRect.height / naturalSize.h);
    const displayedW = naturalSize.w * scale;
    const displayedH = naturalSize.h * scale;
    const offsetX = (containerRect.width - displayedW) / 2;
    const offsetY = (containerRect.height - displayedH) / 2;
    return { x: offsetX + p.x * scale, y: offsetY + p.y * scale };
  }

  /** يبني كائن المعايرة الكامل من النقاط الحالية (أو null إن لم تكتمل بعد) */
  function buildCalibration(): MapCalibration | null {
    if (!points.poleP || !points.cancerP || !points.equatorP || !points.capricornP || !points.greenwichP) {
      return null;
    }
    return {
      imageNaturalWidth: naturalSize.w,
      imageNaturalHeight: naturalSize.h,
      poleP: points.poleP,
      cancerP: points.cancerP,
      equatorP: points.equatorP,
      capricornP: points.capricornP,
      greenwichP: points.greenwichP,
      mirrored: existing?.mirrored ?? false,
      rotationNudgeDeg: existing?.rotationNudgeDeg ?? 0,
    };
  }

  function handleConfirm() {
    const cal = buildCalibration();
    if (cal) finishCalibrating(cal);
  }

  function handleCopy() {
    const cal = buildCalibration() ?? existing;
    if (!cal) return;
    const text = exportCalibrationAsCode(cal);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
        () => window.prompt('انسخ النص التالي يدوياً وأرسله لي:', text)
      );
    } else {
      window.prompt('انسخ النص التالي يدوياً وأرسله لي:', text);
    }
  }

  function restart() {
    setPoints({});
    setStepIndex(0);
  }

  const canCopy = done || !!existing;

  return (
    <div className="calibrator-overlay">
      <div className="calibrator-header">
        <div className="calibrator-title">
          {done ? 'راجع النقاط ثم أكّد' : `الخطوة ${stepIndex + 1} من ${STEPS.length}: ${currentStep.title}`}
        </div>
        <div className="calibrator-actions">
          {canCopy && (
            <button
              className="icon-btn"
              title="نسخ بيانات المعايرة (لإرسالها كقيمة افتراضية دائمة)"
              onClick={handleCopy}
            >
              {copied ? <ClipboardCheck size={18} /> : <Copy size={18} />}
            </button>
          )}
          <button className="icon-btn" title="إعادة من البداية" onClick={restart}>
            <RotateCcw size={18} />
          </button>
          {done && (
            <button className="icon-btn active" title="تأكيد المعايرة (لجهازي فقط)" onClick={handleConfirm}>
              <Check size={18} />
            </button>
          )}
          <button className="icon-btn" title="إلغاء" onClick={cancelCalibrating}>
            <X size={18} />
          </button>
        </div>
      </div>

      {!done && <div className="calibrator-hint">{currentStep.hint}</div>}
      {done && (
        <div className="calibrator-hint">
          اضغط أيقونة النسخ 📋 أعلاه وأرسل النص لي كي أضعه معايرة افتراضية دائمة يراها كل
          الزوار، أو أيقونة ✓ لحفظها على جهازك أنت فقط للتجربة السريعة.
        </div>
      )}

      <div className="calibrator-canvas" ref={containerRef} onClick={handleClick}>
        <img ref={imgRef} src={IMAGE_SRC} alt="خريطة الأرض" onLoad={handleImageLoad} draggable={false} />
        {STEPS.map(({ key, color }) => {
          const p = points[key];
          if (!p) return null;
          const dp = toDisplayPoint(p);
          return (
            <div
              key={key}
              className="calibrator-marker"
              style={{ left: dp.x, top: dp.y, borderColor: color, background: `${color}55` }}
            />
          );
        })}
      </div>
    </div>
  );
}