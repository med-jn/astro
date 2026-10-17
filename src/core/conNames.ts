/**
 * سجل أسماء الكوكبات العربية (iau_con → name_ar) وتسمية Bayer بالعربية.
 * وحدة مستقلة عمداً لتفادي الاستيراد الدائري بين starCatalog وstarGroups:
 * starGroups يُسجّل الأسماء بعد تحميلها من سوبابيز، وstarCatalog يقرأها فقط.
 */
const nameByCon = new Map<string, string>();

export function registerConstellationNames(rows: { iauCon: string | null; nameAr: string }[]): void {
  nameByCon.clear();
  for (const r of rows) {
    if (r.iauCon) nameByCon.set(r.iauCon.trim().toLowerCase(), r.nameAr);
  }
}

export function getConstellationNameAr(con: string | null | undefined): string | null {
  if (!con) return null;
  return nameByCon.get(con.trim().toLowerCase()) ?? null;
}

const GREEK_AR: Record<string, string> = {
  alp: 'ألفا', bet: 'بيتا', gam: 'غاما', del: 'دلتا', eps: 'إبسيلون', zet: 'زيتا',
  eta: 'إيتا', the: 'ثيتا', iot: 'أيوتا', kap: 'كابا', lam: 'لامدا', mu: 'ميو',
  nu: 'نيو', xi: 'كساي', omi: 'أوميكرون', pi: 'باي', rho: 'رو', sig: 'سيغما',
  tau: 'تاو', ups: 'أوبسيلون', phi: 'فاي', chi: 'كاي', psi: 'بساي', ome: 'أوميغا',
};
const SUPERSCRIPT = ['', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const GREEK_GLYPH: Record<string, string> = {
  alp: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε', zet: 'ζ', eta: 'η', the: 'θ', iot: 'ι', kap: 'κ', lam: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', omi: 'ο', pi: 'π', rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', ome: 'ω',
};

/** التسمية اللاتينية المعتمدة: «α Sco» (Bayer) أو «12 UMa» (Flamsteed) برمز الكوكبة IAU */
export function latinBayerLabel(bayer: string | null, flam: string | null, con: string | null): string | null {
  if (!con) return null;
  if (bayer) {
    const m = /^([A-Za-z]+)(?:-(\d+))?$/.exec(bayer.trim());
    const glyph = m ? GREEK_GLYPH[m[1].toLowerCase()] : undefined;
    if (glyph) {
      const n = m && m[2] ? Number(m[2]) : 0;
      return `${glyph}${n > 0 && n < 10 ? SUPERSCRIPT[n] : ''} ${con}`;
    }
  }
  return flam ? `${flam} ${con}` : null;
}

/**
 * تسمية نجم بلا اسم خاص بالعربية: «ألفا العقرب» (Bayer) أو «12 الدب الأكبر» (Flamsteed).
 * تُعيد null إن لم تُحمَّل أسماء الكوكبات بعد (فيعود المستدعي للصيغة اللاتينية).
 */
export function arabicBayerLabel(
  bayer: string | null,
  flam: string | null,
  con: string | null
): string | null {
  const conAr = getConstellationNameAr(con);
  if (!conAr) return null;
  if (bayer) {
    const m = /^([A-Za-z]+)(?:-(\d+))?$/.exec(bayer.trim());
    const greek = m ? GREEK_AR[m[1].toLowerCase()] : undefined;
    if (greek) {
      const n = m && m[2] ? Number(m[2]) : 0;
      const sup = n > 0 && n < 10 ? SUPERSCRIPT[n] : '';
      return `${greek}${sup} ${conAr}`;
    }
  }
  if (flam) return `${flam} ${conAr}`;
  return null;
}