import { describe, expect, it } from 'vitest';
import { airmass, getExtinctionScale } from '../src/core/skyModel';
import {
  ATMOSPHERE_PRESETS, STANDARD_ATMOSPHERE, airRefractivity, applyAtmosphere, dispersionArcsec, horizonAtmosphere, meeusFactor,
  moonSkyCorrection, refractionBennettDeg, refractionSaemundssonDeg, refractivityRatio,
} from '../src/core/atmosphere';
import { directSunLight } from '../src/core/skyRadiance';

const dry = (t: number, p: number) => ({ ...STANDARD_ATMOSPHERE, temperatureC: t, pressureHPa: p, relativeHumidityPct: 0 });

describe('الغلاف الجوي: الكتلة الهوائية', () => {
  it('Kasten & Young 1989: قيم جدولية (0°≈38، 10°≈5.6، 30°≈2.0، 45°≈1.41، 90°≈1.0)', () => {
    const near = (alt: number, x: number, tol: number) => expect(Math.abs(airmass(alt) / x - 1)).toBeLessThan(tol);
    near(0, 38.0, 0.02); near(10, 5.6, 0.02); near(30, 2.0, 0.01); near(45, 1.41, 0.01); near(90, 1.0, 0.01);
  });
});

describe('الغلاف الجوي: الانكسار', () => {
  it('Bennett (ارتفاع ظاهري): 34.5′ عند 0°، 5.4′ عند 10°، 1.0′ عند 45° (جداول الانكسار المتوسط)', () => {
    expect(Math.abs(refractionBennettDeg(0) * 60 - 34.5)).toBeLessThan(0.1);
    expect(Math.abs(refractionBennettDeg(10) * 60 - 5.4)).toBeLessThan(0.1);
    expect(Math.abs(refractionBennettDeg(45) * 60 - 1.0)).toBeLessThan(0.02);
  });
  it('Sæmundsson (ارتفاع حقيقي) أصغر من Bennett عند الأفق (29′ مقابل 34.5′) ومتقارب عند 10°', () => {
    expect(refractionSaemundssonDeg(0) * 60).toBeLessThan(refractionBennettDeg(0) * 60 - 4);
    expect(Math.abs(refractionSaemundssonDeg(10) - refractionBennettDeg(10)) * 60).toBeLessThan(0.1);
  });
  it('معامل Edlén يتفق مع عامل Meeus (P/1010)(283/(273+T)) بأقل من 0.3% (جو جاف) عند ضغطين وحرارتين', () => {
    for (const [t, p] of [[15, 1013.25], [2, 800], [-5, 1030], [30, 1008]] as const) {
      expect(Math.abs(refractivityRatio(dry(t, p)) / meeusFactor(p, t) - 1)).toBeLessThan(0.003);
    }
  });
  it('الرطوبة تُنقص الانكسار قليلاً (حار رطب ≈ −0.7%) ولا تزيده', () => {
    const wet = refractivityRatio({ ...dry(35, 1005), relativeHumidityPct: 80 }), dryR = refractivityRatio(dry(35, 1005));
    expect(wet).toBeLessThan(dryR); expect(wet / dryR).toBeGreaterThan(0.985);
  });
  it('التشتت اللوني: فرق الأزرق/الأحمر عند الأفق عشرات الثواني القوسية ويتناقص بالارتفاع', () => {
    expect(dispersionArcsec(0.5)).toBeGreaterThan(15); expect(dispersionArcsec(0.5)).toBeLessThan(40);
    expect(dispersionArcsec(10)).toBeLessThan(dispersionArcsec(0.5) / 3);
  });
  it('n−1 عند 589 نم والجو القياسي من رتبة 2.77×10⁻⁴', () => {
    expect(Math.abs(airRefractivity(0.58929, 1013.25, 15, 0) / 2.77e-4 - 1)).toBeLessThan(0.01);
  });
});

describe('الغلاف الجوي: الانخماد والتشتت', () => {
  it('نفاذية الضوء المباشر تتناقص رتابةً نحو الأفق ويحمرّ لونه', () => {
    let prev = 1.01, prevG = 1.01, prevB = 1.01;
    for (const a of [90, 45, 20, 10, 5, 2, 0]) {
      const h = horizonAtmosphere(a);
      expect(h.transmittance).toBeLessThan(prev); prev = h.transmittance;
      expect(h.rel[1]).toBeLessThan(prevG + 1e-9); prevG = h.rel[1];
      expect(h.rel[2]).toBeLessThan(prevB + 1e-9); prevB = h.rel[2];
    }
  });
  it('الهباء الأكثر يُنقص ضوء الشمس عند 5° ويحمرّه؛ والضغط الأقل يزيد النفاذية؛ والعودة للقياسي تعيد القيم بالضبط', () => {
    const lumOf = (a: number) => { const r = directSunLight(a).rgb; return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]; };
    applyAtmosphere(STANDARD_ATMOSPHERE); const base = lumOf(5), base30 = directSunLight(30).rgb.join(',');
    applyAtmosphere(ATMOSPHERE_PRESETS.dust); const dust = lumOf(5);
    applyAtmosphere(ATMOSPHERE_PRESETS.high_clear); const high = lumOf(5);
    applyAtmosphere(STANDARD_ATMOSPHERE);
    expect(dust).toBeLessThan(base * 0.5); expect(high).toBeGreaterThan(base * 0.9);
    expect(directSunLight(30).rgb.join(',')).toBe(base30);
  });
  it('الرطوبة العالية تزيد العمق البصري الفعّال للهباء (نمو) فتنقص ضوء الشمس عند 5°', () => {
    const lumOf = (a: number) => { const r = directSunLight(a).rgb; return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]; };
    applyAtmosphere({ ...STANDARD_ATMOSPHERE, relativeHumidityPct: 40 }); const l40 = lumOf(5);
    applyAtmosphere({ ...STANDARD_ATMOSPHERE, relativeHumidityPct: 90 }); const l90 = lumOf(5);
    applyAtmosphere(STANDARD_ATMOSPHERE);
    expect(l90).toBeLessThan(l40);
  });
  it('معامل انخماد النجوم k=1.086·τ(550): الافتراضي 0.20 قدر/كتلة هوائية (يطابق Stellarium)، ويكبر بالهباء ويصغر بالارتفاع', () => {
    applyAtmosphere(STANDARD_ATMOSPHERE); const s0 = getExtinctionScale();
    applyAtmosphere(ATMOSPHERE_PRESETS.dust); const sd = getExtinctionScale();
    applyAtmosphere(ATMOSPHERE_PRESETS.high_clear); const sh = getExtinctionScale();
    applyAtmosphere(STANDARD_ATMOSPHERE);
    expect(Math.abs(s0 - 1)).toBeLessThan(1e-12); expect(sd).toBeGreaterThan(1.5); expect(sh).toBeLessThan(1);
  });
  it('معامل تصحيح هالة القمر (KS91) محدود بين 0.5 و1.35', () => {
    for (const rho of [1, 5, 10, 20, 40, 70, 120]) { const c = moonSkyCorrection(rho); expect(c).toBeGreaterThan(0.49); expect(c).toBeLessThan(1.36); }
  });
});
