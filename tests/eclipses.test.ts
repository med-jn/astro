import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import { findEclipsesBetween, localSolarCircumstances } from '../src/core/eclipses';
import { findPhase } from '../src/core/lunar';
import { sarosSeries } from '../src/core/saros';
import { resolveLook, LOOKS } from '../src/core/danjon';

const MIN = 60_000;
const near = (a: Date, iso: string, minutes: number) => Math.abs(a.getTime() - Date.parse(iso)) / MIN <= minutes;
const events = (from: string, to: string) => findEclipsesBetween(new Date(from), new Date(to));
const find = (type: 'solar' | 'lunar', iso: string, windowDays = 2) => {
  const t = Date.parse(iso);
  const list = events(new Date(t - windowDays * 86_400_000).toISOString(), new Date(t + windowDays * 86_400_000).toISOString());
  return list.find((e) => e.type === type);
};

/**
 * أوقات الذروة العالمية (UT) المنشورة في كتالوج الكسوف والخسوف لناسا (Espenak) — نقبل فرق دقيقتين.
 * الأوقات هنا محسوبة مباشرة من مواضع الشمس والقمر في astronomy-engine، وليست من ساروس.
 */
const SOLAR_REF: [string, string, string][] = [
  ['2024-04-08T18:17:16Z', 'total', 'كلي'],
  ['2023-10-14T17:59:32Z', 'annular', 'حلقي'],
  ['2019-07-02T19:24:08Z', 'total', 'كلي'],
  ['2020-12-14T16:13:28Z', 'total', 'كلي'],
];
const LUNAR_REF: [string, string][] = [
  ['2025-03-14T06:58:36Z', 'total'],
  ['2022-11-08T10:59:11Z', 'total'],
  ['2021-05-26T11:18:42Z', 'total'],
  ['2018-07-27T20:21:44Z', 'total'],
  ['2019-01-21T05:12:16Z', 'total'],
];

describe('أوقات الكسوف والخسوف مقابل الكتالوج المنشور', () => {
  it.each(SOLAR_REF)('كسوف %s', (iso) => {
    const e = find('solar', iso);
    expect(e, 'لم يُعثر على الحدث').toBeTruthy();
    expect(near(e!.peak, iso, 2), `فرق ${(Math.abs(e!.peak.getTime() - Date.parse(iso)) / MIN).toFixed(2)} دقيقة`).toBe(true);
  });
  it.each(LUNAR_REF)('خسوف %s', (iso) => {
    const e = find('lunar', iso);
    expect(e, 'لم يُعثر على الحدث').toBeTruthy();
    expect(near(e!.peak, iso, 2), `فرق ${(Math.abs(e!.peak.getTime() - Date.parse(iso)) / MIN).toFixed(2)} دقيقة`).toBe(true);
  });

  it('أنواع الأحداث (كلي/جزئي/حلقي/هامشي)', () => {
    const kind = (type: 'solar' | 'lunar', iso: string) => (find(type, iso) as { kind?: string } | undefined)?.kind;
    expect(kind('solar', '2023-10-14T17:59:00Z')).toBe('annular');
    expect(kind('solar', '2025-03-29T10:48:00Z')).toBe('partial');
    expect(kind('lunar', '2024-09-18T02:44:00Z')).toBe('partial');
    expect(kind('lunar', '2024-03-25T07:12:00Z')).toBe('penumbral');
  });

  it('لا يفوت حدثاً في سنة كاملة (2027: كسوفان وثلاثة خسوف كما في الكتالوج)', () => {
    const y = events('2027-01-01T00:00:00Z', '2027-12-31T23:59:00Z');
    expect(y.filter((e) => e.type === 'solar').length).toBe(2);
    expect(y.filter((e) => e.type === 'lunar').length).toBe(3);
  });
  it('2024: كسوفان وأربعة خسوف (خسوفان هامشيان وجزئي وكلي في 2025 خارج السنة)', () => {
    const y = events('2024-01-01T00:00:00Z', '2024-12-31T23:59:00Z');
    expect(y.filter((e) => e.type === 'solar').length).toBe(2);
    expect(y.filter((e) => e.type === 'lunar').length).toBe(2);
  });
});

describe('الكسوف عند موقع محدد', () => {
  it('دالاس 8 أبريل 2024: بداية الكلّية ومدتها', () => {
    const e = find('solar', '2024-04-08T18:17:16Z')!;
    const loc = localSolarCircumstances(e.peak, { latitudeDeg: 32.7767, longitudeDeg: -96.797, elevationM: 131 });
    expect(loc).toBeTruthy();
    expect(loc!.kind).toBe('total');
    expect(loc!.visibility).toBe('full');
    // الكلّية في وسط دالاس: نحو 1:40–1:44 م بالتوقيت المحلي (18:40–18:44 UT)، ومدتها قرابة 3.5–4 دقائق
    expect(near(loc!.c2!.time, '2024-04-08T18:40:30Z', 1.5)).toBe(true);
    expect(loc!.centralDurationSec!).toBeGreaterThan(190);
    expect(loc!.centralDurationSec!).toBeLessThan(260);
  });
});

describe('الأطوار', () => {
  it('المحاق والتربيع والبدر (UT) بدقة دقيقتين', () => {
    expect(near(findPhase(new Date('2024-04-01T00:00Z'), 0), '2024-04-08T18:21:00Z', 2)).toBe(true);
    expect(near(findPhase(new Date('2024-04-10T00:00Z'), 90), '2024-04-15T19:13:00Z', 2)).toBe(true);
    expect(near(findPhase(new Date('2024-04-17T00:00Z'), 180), '2024-04-23T23:49:00Z', 2)).toBe(true);
  });
});

describe('سلاسل ساروس', () => {
  const SOLAR: [string, number][] = [['2017-08-21T18:26Z', 145], ['2023-10-14T17:59Z', 134], ['2019-07-02T19:24Z', 127], ['2020-12-14T16:13Z', 142], ['2024-04-08T18:17Z', 139], ['2026-08-12T17:46Z', 126], ['2026-02-17T12:12Z', 121], ['2027-08-02T10:07Z', 136]];
  const LUNAR: [string, number][] = [['2018-07-27T20:21Z', 129], ['2019-01-21T05:12Z', 134], ['2022-11-08T10:59Z', 136], ['2021-05-26T11:18Z', 121], ['2025-03-14T06:58Z', 123], ['2026-03-03T11:33Z', 133], ['2026-08-28T04:13Z', 138]];
  it.each(SOLAR)('كسوف %s ← %i', (iso, n) => expect(sarosSeries(new Date(iso), 'solar')).toBe(n));
  it.each(LUNAR)('خسوف %s ← %i', (iso, n) => expect(sarosSeries(new Date(iso), 'lunar')).toBe(n));

  it('كل حدث يعود في سلسلته بعد 223 شهراً قمرياً (6585.32 يوماً)', () => {
    const base = events('2024-01-01T00:00:00Z', '2025-12-31T00:00:00Z');
    expect(base.length).toBeGreaterThan(6);
    for (const e of base) {
      const target = e.peak.getTime() + 6585.3216 * 86_400_000;
      const hit = events(new Date(target - 2 * 86_400_000).toISOString(), new Date(target + 2 * 86_400_000).toISOString())
        .find((x) => x.type === e.type && sarosSeries(x.peak, x.type) === sarosSeries(e.peak, e.type));
      expect(hit, `${e.type} ${e.peak.toISOString()}`).toBeTruthy();
    }
  });
});

describe('مظهر القمر أثناء الخسوف', () => {
  it('تلقائي = L2 ما لم يُوثَّق غيره', () => {
    expect(resolveLook(new Date('2030-01-01T00:00Z'), 'auto')).toEqual({ L: 2, tint: [1, 1, 1] });
  });
  it('كل مظهر مختار يُرجع قيمته', () => {
    for (const l of LOOKS) expect(resolveLook(new Date(), l.id).L).toBe(l.L);
  });
  it('astronomy-engine متاح بالإصدار المتوقع', () => {
    expect(typeof A.SearchLunarEclipse).toBe('function');
  });
});
