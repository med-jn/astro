import { describe, expect, it } from 'vitest';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import { LOOKS } from '../src/core/danjon';
import { CITIES } from '../src/i18n/names';
import { read, sourceFiles, stripComments, SRC } from './helpers';
import { join } from 'node:path';

const arKeys = Object.keys(ar);
const enKeys = Object.keys(en);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('مفاتيح الترجمة', () => {
  it('العربية والإنجليزية بالمفاتيح نفسها', () => {
    expect(arKeys.filter((k) => !(k in en))).toEqual([]);
    expect(enKeys.filter((k) => !(k in ar))).toEqual([]);
  });

  it('لا قيم فارغة ولا مسافات زائدة', () => {
    for (const [name, d] of [['ar', ar], ['en', en]] as const) {
      for (const [k, v] of Object.entries(d)) {
        expect(v.trim().length, `${name}.${k} فارغ`).toBeGreaterThan(0);
        expect(v, `${name}.${k} فيه مسافات زائدة`).toBe(v.trim());
      }
    }
  });

  it('المتغيّرات {x} متطابقة بين اللغتين', () => {
    for (const k of arKeys) {
      expect(placeholders((en as Record<string, string>)[k]), `المتغيّرات في ${k}`).toBe(placeholders((ar as Record<string, string>)[k]));
    }
  });

  it('النص الإنجليزي ليس منسوخاً من العربي، والعربي يحوي حروفاً عربية', () => {
    for (const k of arKeys) {
      const a = (ar as Record<string, string>)[k], e = (en as Record<string, string>)[k];
      if (k === 'set_lang_en' || k === 'set_lang_ar') continue;
      expect(/[\u0600-\u06FF]/.test(e), `en.${k} يحوي حروفاً عربية`).toBe(false);
      if (/[A-Za-z]{3,}/.test(a)) continue; // نصوص مثل L0 أو ids مقصودة
      expect(/[\u0600-\u06FF]/.test(a), `ar.${k} بلا حروف عربية`).toBe(true);
    }
  });

  /** كل النصوص الحرفية داخل استدعاءات t(...) وtr(...) (تشمل الشرط الثلاثي) */
  const usedLiterals = () => {
    const found: { file: string; key: string }[] = [];
    for (const f of sourceFiles(SRC)) {
      if (f.includes(join('src', 'i18n'))) continue;
      const s = stripComments(read(f));
      for (const call of s.matchAll(/\b(?:t|tr)\(([^()]*)\)/g)) {
        for (const lit of call[1].matchAll(/'([a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)*)'/g)) found.push({ file: f, key: lit[1] });
      }
    }
    return found;
  };

  it('كل مفتاح يُستعمل في الكود موجود في القاموس', () => {
    const missing = usedLiterals().filter((u) => !(u.key in ar) && /_/.test(u.key)).map((u) => `${u.file}: ${u.key}`);
    expect(missing).toEqual([]);
  });

  it('لا مفاتيح يتيمة: كل مفتاح في القاموس مستعمل في الكود', () => {
    const literal = new Set<string>();
    const prefixes: string[] = [];
    for (const f of sourceFiles(SRC)) {
      if (f.includes(join('src', 'i18n', 'ar.ts')) || f.includes(join('src', 'i18n', 'en.ts'))) continue;
      const s = stripComments(read(f));
      for (const m of s.matchAll(/'([a-zA-Z0-9_]+)'/g)) literal.add(m[1]);
      for (const m of s.matchAll(/`([a-zA-Z0-9_]+)\$\{/g)) prefixes.push(m[1]);
    }
    const orphans = arKeys.filter((k) => !literal.has(k) && !prefixes.some((p) => k.startsWith(p)));
    expect(orphans).toEqual([]);
  });

  it('عائلات المفاتيح الديناميكية مكتملة', () => {
    const need = (prefix: string, ids: (string | number)[]) =>
      ids.forEach((id) => expect(`${prefix}${id}` in ar, `ناقص ${prefix}${id}`).toBe(true));
    need('phase_', [0, 1, 2, 3, 4, 5, 6, 7]);
    need('look_', ['auto', ...LOOKS.map((l) => l.id)]);
    need('ev_phase_', ['penumbral', 'partial', 'total', 'annular']);
    need('ecl_', ['total', 'annular', 'partial']);
    need('season_', ['spring', 'summer', 'autumn', 'winter']);
    need('tag_', ['blood', 'super', 'micro', 'blue']);
    need('ep_c_', ['P1', 'U1', 'U2', 'MAX', 'U3', 'U4', 'P4']);
    need('compass_', [0, 1, 2, 3, 4, 5, 6, 7]);
    need('danjon_', [0, 1, 2, 3, 4]);
    need('ev_t_solar_', ['partial', 'annular', 'total', 'hybrid']);
    need('ev_t_lunar_', ['penumbral', 'partial', 'total']);
    need('tab_', ['moon', 'eclipse', 'data']);
    need('', CITIES.map((c) => c.id));
    const store = read(join(SRC, 'state', 'store.ts'));
    const block = store.match(/interface LayerToggles \{([^}]*)\}/)?.[1] ?? '';
    const layers = [...block.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
    expect(layers.length).toBeGreaterThan(5);
    need('layer_', layers);
  });
});
