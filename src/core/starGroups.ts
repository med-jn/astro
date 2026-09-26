import { supabase } from './supabaseClient';
import { getLoadedStars } from './starCatalog';

export interface StarGroupRow {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  figureAr: string | null;
  season: string | null;
  iauCon: string | null;
}

export interface GroupLine {
  hipFrom: number;
  hipTo: number;
}

/**
 * ملاحظة حاسمة (موثّقة سابقاً في المشروع): عمود hip في group_stars/group_lines لا يحمل
 * رقم Hipparcos الحقيقي، بل نفس قيمة id الداخلية لملف public/data/stars.json المحلي.
 * لذلك يجب دائماً البحث بمطابقة hip مع CatalogStar.id تحديداً، لا أي رقم فلكي خارجي.
 */
let groupsById: Map<number, StarGroupRow> = new Map();
let memberHipsByGroup: Map<number, number[]> = new Map();
let linesByGroup: Map<number, GroupLine[]> = new Map();
let loadPromise: Promise<void> | null = null;

/**
 * يحمّل الكوكبات (الأنساق النجمية) من سوبابيز — جدول groups (بيانات الكوكبة نفسها)
 * وgroup_stars (أعضاؤها) وgroup_lines (خطوط رسمها) معاً. بنفس نمط بقية طبقات إثراء
 * سوبابيز في المشروع: تحميل خلفي غير معطِّل، وفشل صامت لا يكسر التطبيق.
 */
export function loadStarGroups(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const [
        { data: groupsData, error: gErr },
        { data: starsData, error: sErr },
        { data: linesData, error: lErr },
      ] = await Promise.all([
        supabase.from('groups').select('id, code, name_ar, name_en, figure_ar, season, iau_con'),
        supabase.from('group_stars').select('group_id, hip'),
        supabase.from('group_lines').select('group_id, hip_from, hip_to, seq').order('seq', { ascending: true }),
      ]);
      if (gErr) throw gErr;
      if (sErr) throw sErr;
      if (lErr) throw lErr;

      const gMap = new Map<number, StarGroupRow>();
      for (const row of groupsData ?? []) {
        gMap.set(row.id, {
          id: row.id,
          code: row.code,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          figureAr: row.figure_ar,
          season: row.season,
          iauCon: row.iau_con,
        });
      }

      const sMap = new Map<number, number[]>();
      for (const row of starsData ?? []) {
        const list = sMap.get(row.group_id) ?? [];
        list.push(row.hip);
        sMap.set(row.group_id, list);
      }

      const lMap = new Map<number, GroupLine[]>();
      for (const row of linesData ?? []) {
        const list = lMap.get(row.group_id) ?? [];
        list.push({ hipFrom: row.hip_from, hipTo: row.hip_to });
        lMap.set(row.group_id, list);
      }

      groupsById = gMap;
      memberHipsByGroup = sMap;
      linesByGroup = lMap;
    } catch (err) {
      console.error('فشل تحميل الكوكبات (groups) من سوبابيز:', err);
    }
  })();
  return loadPromise;
}

/** كل الكوكبات المحمَّلة دفعة واحدة — للبحث أو لقائمة استعراض مستقبلية */
export function getAllLoadedGroups(): StarGroupRow[] {
  return [...groupsById.values()];
}

export function getGroupById(groupId: number): StarGroupRow | undefined {
  return groupsById.get(groupId);
}

export function getGroupLines(groupId: number): GroupLine[] {
  return linesByGroup.get(groupId) ?? [];
}

export function getGroupMemberHips(groupId: number): number[] {
  return memberHipsByGroup.get(groupId) ?? [];
}

/**
 * مركز الكوكبة: متوسط اتجاهي (متجهي) لمواضع كل نجومها الأعضاء على الكرة السماوية —
 * يتجنب أخطاء الالتفاف حول حد 0/24 ساعة في المطلع المستقيم التي يسبّبها المتوسط الحسابي
 * المباشر للأرقام. يُعيد null إن لم تكتمل قراءة سوبابيز بعد أو لم يُطابَق أي عضو بالكتالوج المحلي.
 */
export function computeGroupCenter(groupId: number): { raHours: number; decDeg: number } | null {
  const hips = getGroupMemberHips(groupId);
  if (hips.length === 0) return null;

  const byId = new Map(getLoadedStars().map((s) => [s.id, s]));

  let x = 0, y = 0, z = 0, count = 0;
  for (const hip of hips) {
    const star = byId.get(hip);
    if (!star) continue;
    const raRad = (star.ra / 12) * Math.PI;
    const decRad = (star.dec * Math.PI) / 180;
    x += Math.cos(decRad) * Math.cos(raRad);
    y += Math.cos(decRad) * Math.sin(raRad);
    z += Math.sin(decRad);
    count++;
  }
  if (count === 0) return null;

  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return null;

  const raRad = Math.atan2(y / len, x / len);
  let raHours = (raRad * 12) / Math.PI;
  if (raHours < 0) raHours += 24;
  const decDeg = (Math.asin(z / len) * 180) / Math.PI;

  return { raHours, decDeg };
}