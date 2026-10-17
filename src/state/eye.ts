import { create } from 'zustand';
import type { ProjectionKind } from '../core/camera';

/**
 * حالة «عين الراصد» (الكاميرا والإسقاط وطبقاتها الخاصة). متجر مستقل غير محفوظ:
 * الزمن والموقع وطبقات النجوم/الكواكب/الأسماء/البروج/الشفق والإبرازات كلها من المتجر الرئيسي،
 * فتتحكم بها لوحة التحكم نفسها دون نسخة موازية.
 */
export type LookKind = 'sun' | 'moon' | 'north' | 'east' | 'south' | 'west' | 'zenith' | 'dial';
export type EyeLayer = 'ground' | 'sundial' | 'altAzGrid';

interface EyeState {
  open: boolean;
  projection: ProjectionKind;
  ground: boolean;
  sundial: boolean;
  altAzGrid: boolean;
  /** مرآة لمجال الرؤية الحالي: تكتبها العين وتقرؤها اللوحة */
  fovDeg: number;
  /** أوامر من اللوحة إلى العين (n يزيد مع كل أمر ليُعاد تنفيذ الأمر نفسه) */
  fovCmd: { value: number; n: number } | null;
  lookCmd: { kind: LookKind; n: number } | null;
  setOpen: (v: boolean) => void;
  setProjection: (p: ProjectionKind) => void;
  toggle: (k: EyeLayer) => void;
  mirrorFov: (v: number) => void;
  setFov: (v: number) => void;
  look: (k: LookKind) => void;
}

export const useEyeStore = create<EyeState>()((set, get) => ({
  open: false,
  projection: 'perspective',
  ground: true,
  sundial: true,
  altAzGrid: false,
  fovDeg: 70,
  fovCmd: null,
  lookCmd: null,
  setOpen: (v) => set({ open: v }),
  setProjection: (p) => set({ projection: p }),
  toggle: (k) => set({ [k]: !get()[k] } as Pick<EyeState, EyeLayer>),
  mirrorFov: (v) => { if (Math.abs(get().fovDeg - v) > 0.005) set({ fovDeg: v }); },
  setFov: (v) => set({ fovCmd: { value: v, n: (get().fovCmd?.n ?? 0) + 1 } }),
  look: (k) => set({ lookCmd: { kind: k, n: (get().lookCmd?.n ?? 0) + 1 } }),
}));
