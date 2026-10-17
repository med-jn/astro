import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLang, tr } from '../src/i18n';
import { SPEEDS_EN } from '../src/i18n/en';
import { MANSIONS_EN, mansionName, zodiacName, JUPITER_MOON_NAMES, groupName } from '../src/i18n/names';
import { getAllLunarMansions } from '../src/core/mansions';
import { ZODIAC_ORDER } from '../src/core/zodiac';
import { getZodiacNameAr } from '../src/core/zodiacNamesAr';
import { PLANET_NAMES, PLANET_LABELS_AR, planetLabel } from '../src/core/bodies';
import { SPEED_LABELS_AR } from '../src/state/store';
import { latinBayerLabel } from '../src/core/conNames';
import { eclipseTitle, findEclipsesBetween } from '../src/core/eclipses';
import { getStarDisplayName, type CatalogStar } from '../src/core/starCatalog';

describe('أسماء بالإنجليزية', () => {
  beforeAll(() => setLang('en'));

  it('تسميات السرعة: بعدد العربية نفسه وبلا فراغ', () => {
    expect(SPEEDS_EN.length).toBe(SPEED_LABELS_AR.length);
    SPEEDS_EN.forEach((s) => expect(s.trim().length).toBeGreaterThan(0));
  });

  it('المنازل الثمانية والعشرون: اسم إنجليزي لكل منزلة وبترتيب صحيح', () => {
    const ms = getAllLunarMansions();
    expect(MANSIONS_EN.length).toBe(ms.length);
    ms.forEach((m) => {
      const en = mansionName(m, 'en');
      expect(en, `المنزلة ${m.index}`).not.toBe(m.nameAr);
      expect(/[\u0600-\u06FF]/.test(en)).toBe(false);
    });
    // مرساتان معروفتان: الثانية «البطين» والسابعة عشرة «الإكليل»
    expect(mansionName(ms[1], 'en')).toBe('Al-Butayn');
    expect(ms[1].nameAr).toBe('البطين');
    expect(mansionName(ms[16], 'en')).toBe('Al-Iklil');
    expect(ms[16].nameAr).toBe('الإكليل');
  });

  it('كل برج له اسم إنجليزي', () => {
    ZODIAC_ORDER.forEach((key, i) => {
      const en = zodiacName(String(key), getZodiacNameAr(key, i), 'en');
      expect(/[\u0600-\u06FF]/.test(en), `${key}`).toBe(false);
    });
    expect(ZODIAC_ORDER.length).toBe(12);
  });

  it('الكواكب: عربي وإنجليزي', () => {
    PLANET_NAMES.forEach((p) => {
      expect(PLANET_LABELS_AR[p].length).toBeGreaterThan(0);
      expect(planetLabel(p)).toBe(p);
    });
    for (const k of ['io', 'europa', 'ganymede', 'callisto']) expect(JUPITER_MOON_NAMES[k].en.length).toBeGreaterThan(1);
  });

  it('اسم الكوكبة يتبع اللغة', () => {
    expect(groupName({ nameAr: 'العقرب', nameEn: 'Scorpius' }, 'en')).toBe('Scorpius');
    expect(groupName({ nameAr: 'العقرب', nameEn: null }, 'en')).toBe('العقرب');
    expect(groupName({ nameAr: 'العقرب', nameEn: 'Scorpius' }, 'ar')).toBe('العقرب');
  });

  it('تسمية النجم اللاتينية (Bayer/Flamsteed)', () => {
    expect(latinBayerLabel('Alp', '9', 'CMa')).toBe('α CMa');
    expect(latinBayerLabel('Alp-1', null, 'Cap')).toBe('α¹ Cap');
    expect(latinBayerLabel(null, '12', 'UMa')).toBe('12 UMa');
    expect(latinBayerLabel(null, null, 'UMa')).toBeNull();
  });

  it('كل نجوم الكتالوج التي لها اسم أو Bayer تحصل على اسم عرض إنجليزي بلا عربية', () => {
    const stars = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'stars.json'), 'utf8')) as CatalogStar[];
    let named = 0;
    for (const s of stars) {
      if (!s.name && !(s.bayer && s.con)) continue;
      const n = getStarDisplayName(s);
      if (!n) continue; // Bayer بصيغة غير قياسية مع flam غائب
      named++;
      expect(/[\u0600-\u06FF]/.test(n), `${s.id}: ${n}`).toBe(false);
    }
    expect(named).toBeGreaterThan(1000);
  });

  it('عنوان الحدث يتبع لغة التطبيق', () => {
    const ev = findEclipsesBetween(new Date('2025-03-01T00:00Z'), new Date('2025-03-20T00:00Z'))[0];
    setLang('en');
    expect(eclipseTitle(ev)).toMatch(/eclipse/i);
    setLang('ar');
    expect(eclipseTitle(ev)).toMatch(/كسوف|خسوف/);
    expect(tr('body_sun')).toBe('الشمس');
    setLang('en');
    expect(tr('body_sun')).toBe('Sun');
  });
});
