import { describe, expect, it } from 'vitest';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import { JSX_TEXT, read, rel, sourceFiles, STRING_LITERAL, stripComments } from './helpers';

/**
 * الحياد: واجهة التطبيق تعرض الظواهر كما تُرصد ولا تنسبها إلى سبب (لا ظل، ولا حجب، ولا غيرها).
 * هذا الاختبار يفشل إن ظهرت عبارة من هذا النوع في أي نص يراه المستخدم. التعليقات وأسماء المتغيرات لا تُفحص.
 */
const AR_BANNED = /(?<![\u0621-\u064A])(?:[وفبكل]?ال|لل)?ظل(?![\u0621-\u064A]*[مم])|حجب|احتجاب|محجوب|بركان|ثوران|غبار بركاني/;
const AR_BANNED_STRICT = /(?<![\u0621-\u064A])(?:[وفبكل]?ال|لل)?ظل(?![\u0621-\u064A])|حجب|احتجاب|محجوب|بركان|ثوران/;
const EN_BANNED = /\bshadow|\bumbra|\bpenumbra|occult|eclipsed by|volcan|eruption|blocks? the|covers? the/i;

/** استثناء ضيق: «ظل العمود» اسم صحيح في الساعة الشمسية؛ يُحذف لفظ الظل وحده من مفاتيح eye_sd_ ثم تسري بقية المحظورات عليها. */
const sundialOk = (k: string, v: string, lang: 'ar' | 'en') =>
  k.startsWith('eye_sd_') ? v.replace(lang === 'ar' ? /(?<![\u0621-\u064A])(?:[وفبكل]?ال|لل)?ظل(?![\u0621-\u064A])/g : /\bshadow/gi, '') : v;

describe('الحياد في نصوص الواجهة', () => {
  it('القاموسان العربي والإنجليزي', () => {
    for (const [k, v] of Object.entries(ar)) expect(AR_BANNED_STRICT.test(sundialOk(k, v, 'ar')), `ar.${k}: ${v}`).toBe(false);
    for (const [k, v] of Object.entries(en)) expect(EN_BANNED.test(sundialOk(k, v, 'en')), `en.${k}: ${v}`).toBe(false);
  });

  it('النصوص الحرفية ونصوص JSX في الكود', () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      const s = stripComments(read(f));
      const texts = [...s.matchAll(STRING_LITERAL)].map((m) => m[0]).concat([...s.matchAll(JSX_TEXT)].map((m) => m[1]));
      for (const t of texts) {
        // نصوص عربية فقط: معرّفات داخلية بالإنجليزية (penumbral، umbra…) ليست نصاً معروضاً
        if (/[\u0600-\u06FF]/.test(t) && AR_BANNED_STRICT.test(t)) bad.push(`${rel(f)}: ${t.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('لا مظهر دانجون يذكر سبباً', () => {
    const view = stripComments(read(sourceFiles().find((f) => rel(f) === 'render/eclipseView.ts')!));
    expect(/بركان|ثوران/.test(view)).toBe(false);
  });
});
