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

/** عدد ثواني اليوم الشمسي الكامل — يحوّل زاوية السحب اليدوي (360° = يوم كامل) إلى زمن محاكاة */
export const SECONDS_PER_DAY = 86400;

/** أقصى مسافة تحريك (Pan)، كنسبة من نصف قطر القبة، لكل وحدة تكبير فوق 1x */
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
  /** معدّل دوران زمني يدوي مستمر (درجة/ثانية) بعزم فيزيائي — لا يتباطأ حتى يُلغى */
  customTimeRateDegPerSec: number | null;
  zoomScale: number;
  panX: number;
  panY: number;
  observer: ObserverLocation;
  layers: LayerToggles;
  /** الأبراج المُبرزة حالياً — اختيار متعدد، لا حصر لواحد */
  selectedZodiacs: ZodiacKey[];
  /** فهارس المنازل القمرية المُبرزة (0..27) — اختيار متعدد */
  selectedMansionIndices: number[];

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
  toggleZodiacSelection: (z: ZodiacKey) => void;
  clearZodiacSelection: () => void;
  toggleMansionSelection: (index: number) => void;
  clearMansionSelection: () => void;
  setSceneRotation: (deg: number) => void;
  resetSceneRotation: () => void;

  startCalibrating: () => void;
  cancelCalibrating: () => void;
  finishCalibrating: (cal: MapCalibration) => void;
  updateCalibration: (patch: Partial<MapCalibration>) => void;
  resetCalibration: () => void;
}

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
        equatorialGrid: false,
        mansions: false,
        ecliptic: false,
        stars: false,
        planets: false,
        labels: false,
        observerMarker: false,
      },
      selectedZodiacs: [],
      selectedMansionIndices: [],

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
        const clamped = Math.min(6, Math.max(0.5, z));
        const { panX, panY } = get();
        set({ zoomScale: clamped, ...clampPanToZoom(panX, panY, clamped) });
      },
      setPan: (dxFraction, dyFraction) =>
        set((s) => clampPanToZoom(s.panX + dxFraction, s.panY + dyFraction, s.zoomScale)),
      resetPan: () => set({ panX: 0, panY: 0 }),
      setObserver: (o) => set((s) => ({ observer: { ...s.observer, ...o } })),
      toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
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
      version: 3,
      migrate: (persisted: any) => {
        if (persisted?.layers && 'meridians24' in persisted.layers) delete persisted.layers.meridians24;
        if (persisted && 'isolatedZodiac' in persisted) delete persisted.isolatedZodiac;
        if (persisted && !Array.isArray(persisted.selectedZodiacs)) persisted.selectedZodiacs = [];
        if (persisted && !Array.isArray(persisted.selectedMansionIndices)) persisted.selectedMansionIndices = [];
        return persisted;
      },
      partialize: (s) => ({
        zoomScale: s.zoomScale,
        observer: s.observer,
        layers: s.layers,
        selectedZodiacs: s.selectedZodiacs,
        selectedMansionIndices: s.selectedMansionIndices,
        sceneRotationDeg: s.sceneRotationDeg,
        speedIndex: s.speedIndex,
      }),
    }
  )
);
