import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_OBSERVER } from '../core/observer';
import type { ObserverLocation } from '../types/astro';
import type { ZodiacKey } from '../core/zodiac';
import { getGroupIdsOfStar } from '../core/starGroups';
import type { EclipseFocus } from '../render/eclipseOverlay';

export const SPEED_MULTIPLIERS = [0, 60, 3600, 86400, 86400 * 7, 86400 * 30, 86400 * 365];
export const SPEED_LABELS_AR = [
  'موقوف', '1د/ث', '1س/ث', '1يوم/ث', '1أسبوع/ث', '1شهر/ث', '1سنة/ث',
];

/** عدد ثواني اليوم الشمسي الكامل — يحوّل زاوية السحب اليدوي (360° = يوم كامل) إلى زمن محاكاة */
export const SECONDS_PER_DAY = 86400;

/** أقصى إزاحة لمركز القرص عن مركز الشاشة، كنسبة من نصف قطر القرص الحالي. القيمة 1 تعني أنه
 *  يمكن إيصال أي نقطة من القرص (حتى حافته) إلى منتصف الشاشة عند أي مستوى تكبير — وهذا هو
 *  المطلوب للتنقل الحر. (كان الحد السابق يتناسب مع (التكبير−1) فيمنع التحريك تماماً عند 1x.) */
const PAN_MAX_FRACTION = 1;

const MIN_ZOOM = 0.5;
/** 100x تكفي لإظهار جزيرة بحجم جربة (~25 كم) بنحو 100px، وهي حد بيانات Natural Earth 10m المعتمد */
const MAX_ZOOM = 100;

export interface LayerToggles {
  land: boolean;
  terminator: boolean;
  tropics: boolean;
  /** شبكة الـ10°: 36 خط طول + دوائر العرض */
  meridians: boolean;
  /** الشبكة الكاملة كل درجة (تكيّفية حسب التكبير) */
  gridFull: boolean;
  /** خطوط التوقيت العالمية (نوعها في timeZoneKind) */
  timeZones: boolean;
  equatorialGrid: boolean;
  mansions: boolean;
  ecliptic: boolean;
  stars: boolean;
  planets: boolean;
  labels: boolean;
  observerMarker: boolean;
  /** قبة الراصد: السماء المحلية فوق موقعه بكل الأجرام (انظر render/observerDome.ts) */
  observerDome: boolean;
}

interface SimulationState {
  date: Date;
  isPlaying: boolean;
  speedIndex: number;
  /** معدّل دوران زمني يدوي مستمر (درجة/ثانية) بعزم فيزيائي — لا يتباطأ حتى يُلغى */
  customTimeRateDegPerSec: number | null;
  zoomScale: number;
  panX: number;
  panY: number;
  observer: ObserverLocation;
  layers: LayerToggles;
  /** اسمية: 24 خط طول كل 15° — فعلية: حدود المناطق الزمنية للدول */
  timeZoneKind: 'nominal' | 'legal';
  /** الأبراج المُبرزة حالياً — اختيار متعدد، لا حصر لواحد */
  selectedZodiacs: ZodiacKey[];
  /** فهارس المنازل القمرية المُبرزة (0..27) — اختيار متعدد */
  selectedMansionIndices: number[];
  /** معرّفات الكوكبات (groups) المُبرزة حالياً — اختيار متعدد، بنفس نمط الأبراج والمنازل */
  selectedGroupIds: number[];
  /** النجمة المحدَّدة من البحث (id داخلي) — تُحاط بعلامة تصويب؛ غير محفوظة بين الجلسات */
  highlightedStarId: number | null;
  /** الكسوف/الخسوف المختار من لوحة الكسوف (يُرسم مساره على الأرض)؛ غير محفوظ بين الجلسات */
  eclipseFocus: EclipseFocus | null;

  sceneRotationDeg: number;

  /** أبعاد الكانفس الفعلية بالبكسل (CSS px) — يحدّثها SkyCanvas عند التركيب/تغيير الحجم فقط،
   *  لا كل إطار، لتفادي إعادة رسم غير ضرورية. تُستخدم خارج حلقة الرسم (مثل توسيط نتائج
   *  البحث الفوري) لحساب نفس هندسة الإسقاط المستخدمة فعلياً في اللحظة الحالية. */
  viewportWidth: number;
  viewportHeight: number;

  setDate: (d: Date) => void;
  stepTime: (deltaSeconds: number) => void;
  togglePlay: () => void;
  resetToNow: () => void;
  setSpeedIndex: (i: number) => void;
  setCustomTimeRate: (degPerSec: number | null) => void;
  setZoom: (z: number) => void;
  /** تكبير/تصغير بعامل ضرب مع تثبيت النقطة تحت المؤشر/الأصابع. الإحداثيان نسبتان من نصف قطر
   *  القرص الحالي مقيستان من مركز الكانفس (لا من مركز القرص). */
  zoomAt: (factor: number, anchorXFraction: number, anchorYFraction: number) => void;
  setPan: (dxFraction: number, dyFraction: number) => void;
  resetPan: () => void;
  setObserver: (o: Partial<ObserverLocation>) => void;
  toggleLayer: (key: keyof LayerToggles) => void;
  setTimeZoneKind: (kind: 'nominal' | 'legal') => void;
  toggleTimeZoneKind: () => void;
  toggleZodiacSelection: (z: ZodiacKey) => void;
  clearZodiacSelection: () => void;
  toggleMansionSelection: (index: number) => void;
  clearMansionSelection: () => void;
  toggleGroupSelection: (groupId: number) => void;
  clearGroupSelection: () => void;
  /** يحدّد نجمة ويُبرز كوكبتها (أو يلغي التحديد عند null) */
  focusStar: (starId: number | null) => void;
  setEclipseFocus: (focus: EclipseFocus | null) => void;
  setSceneRotation: (deg: number) => void;
  resetSceneRotation: () => void;
  setViewportSize: (width: number, height: number) => void;
}

function clampPan(panX: number, panY: number): { panX: number; panY: number } {
  const mag = Math.hypot(panX, panY);
  if (mag <= PAN_MAX_FRACTION || mag === 0) return { panX, panY };
  const k = PAN_MAX_FRACTION / mag;
  return { panX: panX * k, panY: panY * k };
}

export const useSimulationStore = create<SimulationState>()(
  persist(
    (set, get) => ({
      date: new Date(),
      isPlaying: true,
      speedIndex: 1,
      customTimeRateDegPerSec: null,
      zoomScale: 1,
      panX: 0,
      panY: 0,
      observer: DEFAULT_OBSERVER,
      layers: {
        land: true,
        terminator: true,
        tropics: false,
        meridians: false,
        gridFull: false,
        timeZones: false,
        equatorialGrid: false,
        mansions: false,
        ecliptic: false,
        stars: false,
        planets: false,
        labels: false,
        observerMarker: false,
        observerDome: false,
      },
      timeZoneKind: 'nominal',
      selectedZodiacs: [],
      selectedMansionIndices: [],
      selectedGroupIds: [],
      highlightedStarId: null,
      eclipseFocus: null,

      sceneRotationDeg: 0,

      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1024,
      viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 768,

      setDate: (d) => set({ date: d }),
      stepTime: (deltaSeconds) => {
        const { date, speedIndex } = get();
        const added = deltaSeconds * SPEED_MULTIPLIERS[speedIndex] * 1000;
        if (added !== 0) set({ date: new Date(date.getTime() + added) });
      },
      togglePlay: () =>
        set((s) => {
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
          isPlaying: degPerSec !== null ? false : s.isPlaying,
        })),
      setZoom: (z) => {
        const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
        const { panX, panY } = get();
        set({ zoomScale: clamped, ...clampPan(panX, panY) });
      },
      // الإزاحة مخزَّنة كنسبة من نصف القطر، فنقطة الخريطة عند منتصف الشاشة تبقى ثابتة عند تغيير
      // التكبير. للتثبيت تحت نقطة أخرى (المؤشر/الأصابع):  pan' = pan + anchor·(1/k − 1)
      zoomAt: (factor, anchorXFraction, anchorYFraction) =>
        set((s) => {
          const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.zoomScale * factor));
          const k = next / s.zoomScale;
          if (k === 1) return {};
          const inv = 1 / k - 1;
          return {
            zoomScale: next,
            ...clampPan(s.panX + anchorXFraction * inv, s.panY + anchorYFraction * inv),
          };
        }),
      setPan: (dxFraction, dyFraction) =>
        set((s) => clampPan(s.panX + dxFraction, s.panY + dyFraction)),
      resetPan: () => set({ panX: 0, panY: 0 }),
      setObserver: (o) => set((s) => ({ observer: { ...s.observer, ...o } })),
      toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
      setTimeZoneKind: (kind) => set({ timeZoneKind: kind }),
      toggleTimeZoneKind: () => set((s) => ({ timeZoneKind: s.timeZoneKind === 'nominal' ? 'legal' : 'nominal' })),
      toggleZodiacSelection: (z) =>
        set((s) => ({
          selectedZodiacs: s.selectedZodiacs.includes(z)
            ? s.selectedZodiacs.filter((x) => x !== z)
            : [...s.selectedZodiacs, z],
        })),
      clearZodiacSelection: () => set({ selectedZodiacs: [] }),
      toggleMansionSelection: (index) =>
        set((s) => ({
          selectedMansionIndices: s.selectedMansionIndices.includes(index)
            ? s.selectedMansionIndices.filter((x) => x !== index)
            : [...s.selectedMansionIndices, index],
        })),
      clearMansionSelection: () => set({ selectedMansionIndices: [] }),
      toggleGroupSelection: (groupId) =>
        set((s) => ({
          selectedGroupIds: s.selectedGroupIds.includes(groupId)
            ? s.selectedGroupIds.filter((x) => x !== groupId)
            : [...s.selectedGroupIds, groupId],
        })),
      clearGroupSelection: () => set({ selectedGroupIds: [], highlightedStarId: null }),
      focusStar: (starId) =>
        set({
          highlightedStarId: starId,
          selectedGroupIds: starId == null ? [] : getGroupIdsOfStar(starId),
        }),
      setEclipseFocus: (focus) => set({ eclipseFocus: focus }),
      setSceneRotation: (deg) => {
        let d = deg % 360;
        if (d < 0) d += 360;
        set({ sceneRotationDeg: d });
      },
      resetSceneRotation: () => set({ sceneRotationDeg: 0 }),
      setViewportSize: (width, height) => set({ viewportWidth: width, viewportHeight: height }),
    }),
    {
      name: 'astro-clock-settings',
      version: 3,
      migrate: (persisted: any) => {
        if (persisted?.layers && 'meridians24' in persisted.layers) delete persisted.layers.meridians24;
        if (persisted && 'isolatedZodiac' in persisted) delete persisted.isolatedZodiac;
        if (persisted && !Array.isArray(persisted.selectedZodiacs)) persisted.selectedZodiacs = [];
        if (persisted && !Array.isArray(persisted.selectedMansionIndices)) persisted.selectedMansionIndices = [];
        if (persisted && !Array.isArray(persisted.selectedGroupIds)) persisted.selectedGroupIds = [];
        return persisted;
      },
      // الإعدادات المحفوظة قبل إضافة طبقات جديدة لا تحتويها؛ ندمجها فوق الافتراضيات بدل أن تحلّ محلها
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SimulationState>;
        return { ...current, ...p, layers: { ...current.layers, ...(p.layers ?? {}) } };
      },
      partialize: (s) => ({
        zoomScale: s.zoomScale,
        observer: s.observer,
        layers: s.layers,
        timeZoneKind: s.timeZoneKind,
        selectedZodiacs: s.selectedZodiacs,
        selectedMansionIndices: s.selectedMansionIndices,
        selectedGroupIds: s.selectedGroupIds,
        sceneRotationDeg: s.sceneRotationDeg,
        speedIndex: s.speedIndex,
      }),
    }
  )
);

// للتجربة من وحدة تحكم المتصفح أثناء التطوير فقط (مثلاً: __sim.getState().toggleLayer('gridFull'))
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __sim: typeof useSimulationStore }).__sim = useSimulationStore;
}
