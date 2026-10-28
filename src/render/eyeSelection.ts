import { dirFromAltAz, type V3 } from '../core/camera';

/** وجهة الكاميرا عند اختيار جديد من القوائم أو البحث (دالة نقية قابلة للاختبار) */
export interface SelState { z: string[]; m: number[]; g: number[]; s: number | null }
export interface SelDeps {
  starById: (id: number) => { ra: number; dec: number } | undefined;
  place: (raHours: number, decDeg: number) => { az: number; alt: number };
  groupCenter: (gid: number) => { raHours: number; decDeg: number } | null;
  groupMembers: (gid: number) => number[];
  zodiac: (key: string) => { az: number; alt: number; rad: number } | null;
  mansionMid: (idx: number) => { raHours: number; decDeg: number } | null;
}
export interface SelTarget { az: number; alt: number; fov: number; kind: 'star' | 'group' | 'zodiac' | 'mansion' }

const sep = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * (180 / Math.PI);

export function selectionTarget(prev: SelState, cur: SelState, d: SelDeps): SelTarget | null {
  if (cur.s !== null && cur.s !== prev.s) {
    const st = d.starById(cur.s);
    if (st) { const p = d.place(st.ra, st.dec); return { az: p.az, alt: p.alt, fov: 24, kind: 'star' }; }
  }
  const g = cur.g.find((x) => !prev.g.includes(x));
  if (g !== undefined) {
    const c = d.groupCenter(g);
    if (c) {
      const p = d.place(c.raHours, c.decDeg), c0 = dirFromAltAz(p.alt, p.az);
      let rad = 6;
      for (const hip of d.groupMembers(g)) { const sp = d.starById(hip); if (!sp) continue; const q = d.place(sp.ra, sp.dec); rad = Math.max(rad, sep(c0, dirFromAltAz(q.alt, q.az))); }
      return { az: p.az, alt: p.alt, fov: rad * 2.5, kind: 'group' };
    }
  }
  const z = cur.z.find((x) => !prev.z.includes(x));
  if (z !== undefined) { const i = d.zodiac(z); if (i) return { az: i.az, alt: i.alt, fov: Math.max(20, i.rad * 2.5), kind: 'zodiac' }; }
  const m = cur.m.find((x) => !prev.m.includes(x));
  if (m !== undefined) { const c = d.mansionMid(m); if (c) { const p = d.place(c.raHours, c.decDeg); return { az: p.az, alt: p.alt, fov: 36, kind: 'mansion' }; } }
  return null;
}
