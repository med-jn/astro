import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_OBSERVER } from '../core/observer';
import type { ObserverLocation } from '../types/astro';
import type { ZodiacKey } from '../core/zodiac';
import { loadSavedCalibration, saveCalibration, clearCalibration, type MapCalibration } from '../core/mapCalibration';

export const SPEED_MULTIPLIERS = [0, 60, 3600, 86400, 86400 * 7, 86400 * 30, 86400 * 365];
export const SPEED_LABELS_AR = [
  'موقوف', '1د/ث', '1س/ث', '1يوم/ث', '1أسبوع/ث', '1شهر/ث', '1سنة/ث',
];

/** عدد ثواني اليوم الشمسي الكامل — يُستخدم لتحويل زاوية السحب اليدوي داخل المشهد (360° = يوم
 * كامل من دوران الأرض) إلى زمن محاكاة فعلي، بنفس المنطق الفلكي الذي تعتمد عليه كل الإسقاطات. */
export const SECONDS_PER_DAY = 86400;

/** أقصى مسافة تحريك (Pan) مسموح بها، كنسبة من نصف قطر القبة، لكل وحدة تكبير فوق 1x.
 * عند التكبير 1x أو أقل: لا تحريك مسموح إطلاقاً (القبة كاملة تظهر أصلاً، لا حاجة له). */
const PAN_CLAMP_FACTOR = 0.35;

export interface LayerToggles {
  land: boolean;
  terminator: boolean;
  tropics: boolean;
  meridians: boolean;
  equatorialGrid: boolean;
  mansions: boolean;
  ecliptic: boolean;
  stars: boolean;
  planets: boolean;
  labels: boolean;
  observerMarker: boolean;
}

interface SimulationState {
  date: Date;
  isPlaying: boolean;
  speedIndex: number;
  /** معدّل دوران زمني يدوي مستمر (درجة/ثانية) — يُضبط عند إفلات سحبة داخل المشهد بعزم
   * فيزيائي حقيقي؛ يبقى ثابتاً دون أي تباطؤ تلقائي حتى يُلغى بنقرة داخل المشهد أو بزر
   * التشغيل/الإيقاف. عندما لا يكون null، يتجاوز هذا المعدل speedIndex/isPlaying تماماً. */
  customTimeRateDegPerSec: number | null;
  zoomScale: number;
  /** إزاحة تحريك المشهد (Pan) بعد التكبير — كنسبة من نصف قطر القبة الحالي (عادة بين -1 و1
   * تقريباً)، تُطبَّق كترجمة في فضاء الشاشة داخل renderSky، فتبقى متناسبة تلقائياً مع أي
   * تكبير لاحق بدل أن تُصبح بلا معنى إذا تغيّر مستوى التكبير بعد التحريك. */
  panX: number;
  panY: number;
  observer: ObserverLocation;
  layers: LayerToggles;
  isolatedZodiac: ZodiacKey | null;

  sceneRotationDeg: number;

  calibration: MapCalibration | null;
  isCalibrating: boolean;

  setDate: (d: Date) => void;
  stepTime: (deltaSeconds: number) => void;
  togglePlay: () => void;
  resetToNow: () => void;
  setSpeedIndex: (i: number) => void;
  setCustomTimeRate: (degPerSec: number | null) => void;
  setZoom: (z: number) => void;
  setPan: (dxFraction: number, dyFraction: number) => void;
  resetPan: () => void;
  setObserver: (o: Partial<ObserverLocation>) => void;
  toggleLayer: (key: keyof LayerToggles) => void;
  setIsolatedZodiac: (z: ZodiacKey | null) => void;
  setSceneRotation: (deg: number) => void;
  resetSceneRotation: () => void;

  startCalibrating: () => void;
  cancelCalibrating: () => void;
  finishCalibrating: (cal: MapCalibration) => void;
  updateCalibration: (patch: Partial<MapCalibration>) => void;
  resetCalibration: () => void;
}

/** يُطبَّق في نقطتين (setZoom وsetPan) فيبقى التحريك ضمن حدود منطقية دائماً — سواء تغيّر
 * التكبير أو تغيّرت الإزاحة نفسها، بلا حاجة لتكرار منطق القصّ (Clamp) في كل مكان. */
function clampPanToZoom(panX: number, panY: number, zoomScale: number): { panX: number; panY: number } {
  const maxFraction = Math.max(0, zoomScale - 1) * PAN_CLAMP_FACTOR;
  const mag = Math.hypot(panX, panY);
  if (mag <= maxFraction || mag === 0) return { panX, panY };
  const k = maxFraction / mag;
  return { panX: panX * k, panY: panY * k };
}

export const useSimulationStore = create<SimulationState>()(
  persist(
    (set, get) => ({
      date: new Date(),
      // الحالة الافتراضية: يعمل المحاكي مباشرة بسرعة "1 دقيقة لكل ثانية" — لا يبدأ موقوفاً
      isPlaying: true,
      speedIndex: 1,
      customTimeRateDegPerSec: null,
      zoomScale: 1,
      panX: 0,
      panY: 0,
      observer: DEFAULT_OBSERVER,
      layers: {
        // الحالة الافتراضية: الأرض والظل فقط مفعّلتان — بقية الطبقات يفعّلها المستخدم بنفسه
        land: true,
        terminator: true,
        tropics: false,
        meridians: false,
        equatorialGrid: false,
        mansions: false,
        ecliptic: false,
        stars: false,
        planets: false,
        labels: false,
        observerMarker: false,
      },
      isolatedZodiac: null,

      sceneRotationDeg: 0,

      calibration: loadSavedCalibration(),
      isCalibrating: false,

      setDate: (d) => set({ date: d }),
      stepTime: (deltaSeconds) => {
        const { date, speedIndex } = get();
        const added = deltaSeconds * SPEED_MULTIPLIERS[speedIndex] * 1000;
        if (added !== 0) set({ date: new Date(date.getTime() + added) });
      },
      togglePlay: () =>
        set((s) => {
          // زر التشغيل/الإيقاف هو "الملاذ الأخير" لإيقاف أي حركة زمنية جارية أياً كان
          // مصدرها: تشغيلاً تلقائياً بالسرعة المحددة، أو دوراناً يدوياً مستمراً ناتجاً عن
          // سحبة سابقة (customTimeRateDegPerSec) — في هذه الحالة يوقف كل شيء دفعة واحدة
          if (s.customTimeRateDegPerSec !== null) {
            return { customTimeRateDegPerSec: null, isPlaying: false };
          }
          const next = !s.isPlaying;
          return { isPlaying: next, speedIndex: next && s.speedIndex === 0 ? 2 : s.speedIndex };
        }),
      resetToNow: () => set({ date: new Date() }),
      setSpeedIndex: (i) => set({ speedIndex: i }),
      setCustomTimeRate: (degPerSec) =>
        set((s) => ({
          customTimeRateDegPerSec: degPerSec,
          // عند تفعيل معدّل يدوي جديد نوقف وضع التشغيل التلقائي بالسرعة المحددة كي لا يتراكم
          // الاثنان معاً؛ عند إلغائه (null) نُبقي isPlaying كما كان (يبقى موقوفاً افتراضياً)
          isPlaying: degPerSec !== null ? false : s.isPlaying,
        })),
      setZoom: (z) => {
        const clamped = Math.min(6, Math.max(0.5, z));
        const { panX, panY } = get();
        const nextPan = clampPanToZoom(panX, panY, clamped);
        set({ zoomScale: clamped, ...nextPan });
      },
      setPan: (dxFraction, dyFraction) =>
        set((s) => clampPanToZoom(s.panX + dxFraction, s.panY + dyFraction, s.zoomScale)),
      resetPan: () => set({ panX: 0, panY: 0 }),
      setObserver: (o) => set((s) => ({ observer: { ...s.observer, ...o } })),
      toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
      setIsolatedZodiac: (z) => set({ isolatedZodiac: z }),
      setSceneRotation: (deg) => {
        let d = deg % 360;
        if (d < 0) d += 360;
        set({ sceneRotationDeg: d });
      },
      resetSceneRotation: () => set({ sceneRotationDeg: 0 }),

      startCalibrating: () => set({ isCalibrating: true }),
      cancelCalibrating: () => set({ isCalibrating: false }),
      finishCalibrating: (cal) => {
        saveCalibration(cal);
        set({ calibration: cal, isCalibrating: false });
      },
      updateCalibration: (patch) =>
        set((s) => {
          if (!s.calibration) return {};
          const next = { ...s.calibration, ...patch };
          saveCalibration(next);
          return { calibration: next };
        }),
      resetCalibration: () => {
        clearCalibration();
        set({ calibration: null });
      },
    }),
    {
      name: 'astro-clock-settings',
      version: 2,
      // ترقية بسيطة من النسخة السابقة (v1): حذف meridians24 من أي بيانات محفوظة قديمة
      migrate: (persisted: any) => {
        if (persisted?.layers && 'meridians24' in persisted.layers) {
          delete persisted.layers.meridians24;
        }
        return persisted;
      },
      partialize: (s) => ({
        zoomScale: s.zoomScale,
        observer: s.observer,
        layers: s.layers,
        isolatedZodiac: s.isolatedZodiac,
        sceneRotationDeg: s.sceneRotationDeg,
        speedIndex: s.speedIndex,
        // ملاحظة: panX/panY وcustomTimeRateDegPerSec مقصود عدم حفظهما — حالتا تفاعل مؤقتتان
        // يُفضَّل أن تبدآ نظيفتين (0 وnull) في كل تحميل جديد للصفحة
      }),
    }
  )
);