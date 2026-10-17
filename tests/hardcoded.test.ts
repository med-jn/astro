import { describe, expect, it } from 'vitest';
import { JSX_TEXT, read, rel, sourceFiles, STRING_LITERAL, stripComments } from './helpers';

/**
 * لا نص عربي ثابت في كود الواجهة: كل نص يراه المستخدم يمر عبر القاموس (t / tr) فيُترجَم.
 * الاستثناءات جداول بيانات عربية مقصودة، ورسائل المطوّر في الـ console، وقواعد التطبيع.
 */
const ALLOWED_FILES = new Set([
  'core/bodies.ts', // أسماء الكواكب العربية (جدول بيانات)
  'core/conNames.ts', // أسماء الحروف اليونانية العربية
  'core/contentRegistry.ts', // محتوى الشمس والقمر (عربي + إنجليزي)
  'core/mansions.ts', // أسماء المنازل العربية
  'core/zodiacNamesAr.ts', // أسماء الأبراج العربية
  'state/store.ts', // تسميات السرعة العربية
  'core/starSearch.ts', // قواعد تطبيع النص العربي
  'core/starCatalog.ts', 'core/starGroups.ts', 'core/zodiac.ts', 'core/vectorMap.ts', 'core/supabaseClient.ts', // رسائل المطوّر
]);
const PUNCT_ONLY = /^[\s'"`،؛؟.:,;()\-–—|·•/\\]*$/;

describe('لا نصوص عربية ثابتة خارج القاموس', () => {
  it('الكود الذي يعرض نصاً للمستخدم', () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      const r = rel(f);
      if (r.startsWith('i18n/') || ALLOWED_FILES.has(r)) continue;
      const s = stripComments(read(f));
      const texts = [...s.matchAll(STRING_LITERAL)].map((m) => m[0]).concat([...s.matchAll(JSX_TEXT)].map((m) => m[1]));
      for (const t of texts) {
        if (!/[\u0600-\u06FF]/.test(t)) continue;
        if (PUNCT_ONLY.test(t.replace(/[\u0600-\u06FF]/g, '؛'))) { if (/^[\s'"`]*[،]+[\s'"`]*$/.test(t)) continue; }
        bad.push(`${r}: ${t.slice(0, 70)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
