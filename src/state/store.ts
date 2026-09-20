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
  zoomScale: number;
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
  setZoom: (z: number) => void;
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

export const useSimulationStore = create<SimulationState>()(
  persist(
    (set, get) => ({
      date: new Date(),
      isPlaying: false,
      speedIndex: 0,
      zoomScale: 1,
      observer: DEFAULT_OBSERVER,
      layers: {
        land: true,
        terminator: true,
        tropics: true,
        meridians: true,
        equatorialGrid: true,
        mansions: true,
        ecliptic: true,
        stars: true,
        planets: true,
        labels: true,
        observerMarker: true,
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
          const next = !s.isPlaying;
          return { isPlaying: next, speedIndex: next && s.speedIndex === 0 ? 2 : s.speedIndex };
        }),
      resetToNow: () => set({ date: new Date() }),
      setSpeedIndex: (i) => set({ speedIndex: i }),
      setZoom: (z) => set({ zoomScale: z }),
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
      }),
    }
  )
);