import { create } from 'zustand';
import type { ProjectionKind } from '../core/camera';
import { applyAtmosphere, ATMOSPHERE_PRESETS, STANDARD_ATMOSPHERE, type AtmosphereParams } from '../core/atmosphere';

/**
 * حالة «عين الراصد» (الكاميرا والإسقاط وطبقاتها الخاصة). متجر مستقل غير محفوظ:
 * الزمن والموقع وطبقات النجوم/الكواكب/الأسماء/البروج/الشفق والإبرازات كلها من المتجر الرئيسي،
 * فتتحكم بها لوحة التحكم نفسها دون نسخة موازية.
 */
export type LookKind = 'sun' | 'moon' | 'north' | 'east' | 'south' | 'west' | 'zenith' | 'dial';
export type EyeLayer = 'ground' | 'sundial' | 'altAzGrid';
/** جرم تتبعه الكاميرا: تبقيه في منتصف الإطار مع حركة الزمن */
export type TrackTarget = { kind: 'sun' } | { kind: 'moon' } | { kind: 'planet'; name: string } | { kind: 'zodiac'; key: string } | { kind: 'star' };

interface EyeState {
  open: boolean;
  projection: ProjectionKind;
  ground: boolean;
  sundial: boolean;
  altAzGrid: boolean;
  /** ملء الشاشة: يخفي كل النوافذ ويجعل المشهد يملأ الشاشة */
  immersive: boolean;
  /** فلتر شمسي (ضوء أبيض): كل شيء معتم عدا قرص الشمس ببقعه */
  solarFilter: boolean;
  track: TrackTarget | null;
  /** الغلاف الجوي: يُطبَّق على السماء والانكسار والانخماد في كل التطبيق (القبة أيضاً) */
  atmosphere: AtmosphereParams;
  atmVersion: number;
  /** مرآة لمجال الرؤية الحالي: تكتبها العين وتقرؤها اللوحة */
  fovDeg: number;
  /** أوامر من اللوحة إلى العين (n يزيد مع كل أمر ليُعاد تنفيذ الأمر نفسه) */
  fovCmd: { value: number; n: number } | null;
  lookCmd: { kind: LookKind; n: number } | null;
  /** أمر ضبط التكبير الزاوي (×1 = حجم طبيعي) */
  magCmd: { value: number; n: number } | null;
  setOpen: (v: boolean) => void;
  setProjection: (p: ProjectionKind) => void;
  toggle: (k: EyeLayer) => void;
  mirrorFov: (v: number) => void;
  setFov: (v: number) => void;
  look: (k: LookKind) => void;
  setMagnification: (m: number) => void;
  setImmersive: (v: boolean) => void;
  setSolarFilter: (v: boolean) => void;
  setTrack: (t: TrackTarget | null) => void;
  setAtmosphere: (patch: Partial<AtmosphereParams>) => void;
  setAtmospherePreset: (key: string) => void;
}

export const useEyeStore = create<EyeState>()((set, get) => ({
  open: false,
  projection: 'perspective',
  ground: true,
  sundial: true,
  altAzGrid: false,
  immersive: false,
  solarFilter: false,
  track: null,
  atmosphere: { ...STANDARD_ATMOSPHERE },
  atmVersion: 0,
  fovDeg: 46,
  fovCmd: null,
  lookCmd: null,
  magCmd: null,
  setOpen: (v) => set({ open: v }),
  setProjection: (p) => set({ projection: p }),
  toggle: (k) => set({ [k]: !get()[k] } as Pick<EyeState, EyeLayer>),
  mirrorFov: (v) => { if (Math.abs(get().fovDeg - v) > 0.005) set({ fovDeg: v }); },
  setFov: (v) => set({ fovCmd: { value: v, n: (get().fovCmd?.n ?? 0) + 1 } }),
  look: (k) => set({ lookCmd: { kind: k, n: (get().lookCmd?.n ?? 0) + 1 }, track: null }),
  setMagnification: (m) => set({ magCmd: { value: m, n: (get().magCmd?.n ?? 0) + 1 } }),
  setImmersive: (v) => set({ immersive: v }),
  setSolarFilter: (v) => set({ solarFilter: v }),
  setTrack: (t) => set({ track: t }),
  setAtmosphere: (patch) => { const a = { ...get().atmosphere, ...patch }; applyAtmosphere(a); set({ atmosphere: a, atmVersion: get().atmVersion + 1 }); },
  setAtmospherePreset: (key) => { const a = { ...(ATMOSPHERE_PRESETS[key] ?? STANDARD_ATMOSPHERE) }; applyAtmosphere(a); set({ atmosphere: a, atmVersion: get().atmVersion + 1 }); },
}));
