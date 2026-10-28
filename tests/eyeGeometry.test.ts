import { describe, expect, it } from 'vitest';
import { dirFromAltAz, makeProjector, type ProjectionKind } from '../src/core/camera';
import { CSS_PX_DEG, fovForMagnification, magnificationAt } from '../src/render/eyeScale';
import { AU_KM, PLANET_RADII_KM, SATURN_RING_OUTER } from '../src/render/eyePlanets';
import { selectionTarget } from '../src/render/eyeSelection';

const W = 1560, H = 1079;
const PROJECTIONS: ProjectionKind[] = ['perspective', 'stereographic', 'equidistant'];
const cam = (projection: ProjectionKind, fovDeg: number) => ({ azDeg: 180, altDeg: 20, rollDeg: 0, fovDeg, projection });

describe('هندسة عين الراصد: المقاييس الزاوية', () => {
  it('نقطة على ارتفاع +fov/2 فوق مركز الإطار تقع على حافته العليا (المجال رأسي) في الإسقاطات الثلاثة', () => {
    for (const proj of PROJECTIONS) for (const fov of [0.1, 1, 10, 46, 90]) {
      const P = makeProjector(cam(proj, fov), W, H);
      const out = { x: 0, y: 0 };
      expect(P.project(dirFromAltAz(20 + fov / 2, 180), out)).toBe(true);
      expect(Math.abs(out.y)).toBeLessThan(0.6);
    }
  });
  it('التكبير الزاوي ↔ المجال: fovForMagnification معكوس magnificationAt', () => {
    for (const proj of PROJECTIONS) for (const m of [0.5, 1, 4, 16, 64]) {
      const fov = fovForMagnification(proj, H, m);
      const P = makeProjector(cam(proj, fov), W, H);
      expect(magnificationAt(P) / m).toBeGreaterThan(0.995);
      expect(magnificationAt(P) / m).toBeLessThan(1.005);
    }
  });
  it('عند ×1 قرص الشمس (0.533°) يظهر بحجمه الزاوي الحقيقي: 0.533°/0.0213° ≈ 25 بكسل CSS', () => {
    const fov = fovForMagnification('perspective', H, 1);
    const P = makeProjector(cam('perspective', fov), W, H);
    const d = dirFromAltAz(20, 180);
    const px = 0.533 * (Math.PI / 180) * P.scaleAt(d);
    expect(Math.abs(px - 0.533 / CSS_PX_DEG)).toBeLessThan(0.3);
  });
  it('الزوم يتناسب عكسياً مع tan(fov/2) في المنظوري (لا قصّ داخلي للمجال)', () => {
    const s = (f: number) => makeProjector(cam('perspective', f), W, H).scaleAt(dirFromAltAz(20, 180));
    for (const [a, b] of [[0.06, 0.12], [0.12, 0.5], [1, 4]]) {
      const expected = Math.tan((b * Math.PI) / 360) / Math.tan((a * Math.PI) / 360);
      expect(Math.abs(s(a) / s(b) / expected - 1)).toBeLessThan(1e-6);
    }
  });
});

describe('هندسة عين الراصد: الكواكب', () => {
  it('الأقطار الزاوية الفيزيائية بالرتب المعروفة (مشتري عند 5.2 و.ف ≈ 0.0053° نصف قطر؛ زحل عند 9.2 و.ف ≈ 0.0025°)', () => {
    const deg = (name: string, au: number) => ((PLANET_RADII_KM[name].eq / (au * AU_KM)) * 180) / Math.PI;
    expect(Math.abs(deg('Jupiter', 5.2) - 0.00527)).toBeLessThan(0.0002);
    expect(Math.abs(deg('Saturn', 9.2) - 0.00251)).toBeLessThan(0.0001);
  });
  it('حلقة A الخارجية لزحل 2.269 من نصف قطره الاستوائي، وتفلطح زحل 0.902', () => {
    expect(Math.abs(SATURN_RING_OUTER - 2.2694)).toBeLessThan(0.001);
    expect(Math.abs(PLANET_RADII_KM.Saturn.pol / PLANET_RADII_KM.Saturn.eq - 0.902)).toBeLessThan(0.001);
  });
  it('الكوكب عند الرصد العادي أصغر من 1 بكسل (نقطة)، والشمس أكبر منه بمئات المرات', () => {
    const P = makeProjector(cam('perspective', 46), W, H), d = dirFromAltAz(20, 180);
    const venusPx = (PLANET_RADII_KM.Venus.eq / (0.45 * AU_KM)) * P.scaleAt(d);
    const sunPx = 0.2665 * (Math.PI / 180) * P.scaleAt(d);
    expect(venusPx).toBeLessThan(1);
    expect(sunPx / venusPx).toBeGreaterThan(20);
  });
});

describe('انتقال الكاميرا عند الاختيار', () => {
  const deps = {
    starById: (id: number) => (id === 7 ? { ra: 6.75, dec: -16.7 } : undefined),
    place: (ra: number, dec: number) => ({ az: ra * 15, alt: dec }),
    groupCenter: () => null, groupMembers: () => [] as number[], zodiac: () => null, mansionMid: () => null,
  };
  it('نجم جديد مختار يعطي وجهة بسمته وارتفاعه، وبلا تغيير يعطي null', () => {
    const none = { z: [] as string[], m: [] as number[], g: [] as number[], s: null as number | null };
    const t = selectionTarget(none, { ...none, s: 7 }, deps);
    expect(t).not.toBeNull();
    expect(Math.abs((t?.az ?? 0) - 101.25)).toBeLessThan(1e-9);
    expect(selectionTarget({ ...none, s: 7 }, { ...none, s: 7 }, deps)).toBeNull();
  });
});
