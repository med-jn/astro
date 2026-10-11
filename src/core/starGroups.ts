import { supabase, fetchAllRows } from './supabaseClient';
import { getStarByIdMap } from './starCatalog';
import { registerConstellationNames } from './conNames';

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

export interface GroupMember {
  hip: number;
  roleAr: string | null;
  isPrincipal: boolean;
}

/**
 * ملاحظة حاسمة: عمود hip في group_stars/group_lines هو نفس id الداخلي لـ public/data/stars.json
 * وليس رقم Hipparcos الحقيقي. لذلك المطابقة دائماً مع CatalogStar.id.
 *
 * جدول groups يحوي الآن نوعين: الكوكبات الـ88 (iau_con غير فارغ) ومجموعات المنازل القمرية
 * (iau_con فارغ). قوائم الكوكبات والبحث يجب أن تستخدم getConstellationGroups حصراً.
 */
let groupsById: Map<number, StarGroupRow> = new Map();
let membersByGroup: Map<number, GroupMember[]> = new Map();
let linesByGroup: Map<number, GroupLine[]> = new Map();
let aliasesByGroup: Map<number, string[]> = new Map();
let mansionGroupByIdx: Map<number, number> = new Map();
let groupIdsByStar: Map<number, number[]> = new Map();
let loadPromise: Promise<void> | null = null;

export function loadStarGroups(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      // fetchAllRows يتجاوز حد 1000 صف الصامت في Supabase (group_stars وgroup_lines أكبر منه)
      const [groupsData, starsData, linesData] = await Promise.all([
        fetchAllRows<any>('groups', 'id, code, name_ar, name_en, figure_ar, season, iau_con', ['id']),
        fetchAllRows<any>('group_stars', 'group_id, hip, role_ar, order_idx, is_principal', ['group_id', 'hip']),
        fetchAllRows<any>('group_lines', 'group_id, hip_from, hip_to, seq', ['group_id', 'seq']),
      ]);

      const gMap = new Map<number, StarGroupRow>();
      for (const row of groupsData) {
        gMap.set(row.id, {
          id: row.id,
          code: row.code,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          figureAr: row.figure_ar,
          season: row.season,
          iauCon: row.iau_con ? String(row.iau_con).trim() : null,
        });
      }

      const sMap = new Map<number, GroupMember[]>();
      const sorted = [...starsData].sort(
        (a, b) => a.group_id - b.group_id || (a.order_idx ?? 999) - (b.order_idx ?? 999)
      );
      for (const row of sorted) {
        const list = sMap.get(row.group_id) ?? [];
        list.push({ hip: row.hip, roleAr: row.role_ar ?? null, isPrincipal: !!row.is_principal });
        sMap.set(row.group_id, list);
      }

      const lMap = new Map<number, GroupLine[]>();
      for (const row of linesData) {
        const list = lMap.get(row.group_id) ?? [];
        list.push({ hipFrom: row.hip_from, hipTo: row.hip_to });
        lMap.set(row.group_id, list);
      }

      const byStar = new Map<number, number[]>();
      for (const [gid, members] of sMap) {
        if (!gMap.get(gid)?.iauCon) continue; // الكوكبات فقط، لا مجموعات المنازل
        for (const m of members) {
          const arr = byStar.get(m.hip) ?? [];
          if (!arr.includes(gid)) arr.push(gid);
          byStar.set(m.hip, arr);
        }
      }
      groupIdsByStar = byStar;
      groupsById = gMap;
      membersByGroup = sMap;
      linesByGroup = lMap;
      registerConstellationNames([...gMap.values()].map((g) => ({ iauCon: g.iauCon, nameAr: g.nameAr })));
    } catch (err) {
      console.error('فشل تحميل الكوكبات (groups) من سوبابيز:', err);
    }

    // طبقتان اختياريتان منفصلتان: فشلهما (مثل غياب الجدول) لا يمسّ الكوكبات نفسها
    try {
      const aliases = await fetchAllRows<any>('group_aliases', 'group_id, alias_ar', ['id']);
      const aMap = new Map<number, string[]>();
      for (const row of aliases) {
        const list = aMap.get(row.group_id) ?? [];
        list.push(row.alias_ar);
        aMap.set(row.group_id, list);
      }
      aliasesByGroup = aMap;
    } catch (err) {
      console.warn('group_aliases غير متاح:', err);
    }

    try {
      const { data, error } = await supabase.from('lunar_mansions').select('idx, group_id');
      if (error) throw error;
      mansionGroupByIdx = new Map(
        (data ?? []).filter((r: any) => r.group_id != null).map((r: any) => [r.idx as number, r.group_id as number])
      );
    } catch (err) {
      console.warn('تعذّر ربط المنازل بمجموعاتها:', err);
    }
  })();
  return loadPromise;
}

export function getAllLoadedGroups(): StarGroupRow[] {
  return [...groupsById.values()];
}

/** الكوكبات الـ88 فقط (تستثني مجموعات المنازل القمرية) */
export function getConstellationGroups(): StarGroupRow[] {
  return [...groupsById.values()].filter((g) => g.iauCon !== null);
}

export function getGroupById(groupId: number): StarGroupRow | undefined {
  return groupsById.get(groupId);
}

export function getGroupLines(groupId: number): GroupLine[] {
  return linesByGroup.get(groupId) ?? [];
}

export function getGroupMembers(groupId: number): GroupMember[] {
  return membersByGroup.get(groupId) ?? [];
}

export function getGroupMemberHips(groupId: number): number[] {
  return getGroupMembers(groupId).map((m) => m.hip);
}

/** الكوكبات (الـ88) التي تنتمي إليها نجمة (id الداخلي) */
export function getGroupIdsOfStar(starId: number): number[] {
  return groupIdsByStar.get(starId) ?? [];
}

export function getGroupAliases(groupId: number): string[] {
  return aliasesByGroup.get(groupId) ?? [];
}

/** معرّف مجموعة نجوم المنزلة القمرية (idx من 1 إلى 28 كما في جدول lunar_mansions) */
export function getMansionGroupId(mansionIdx: number): number | undefined {
  return mansionGroupByIdx.get(mansionIdx);
}

/**
 * مركز الكوكبة: متوسط متجهي لمواضع نجومها (يتفادى مشكلة حد 0/24 ساعة).
 */
export function computeGroupCenter(groupId: number): { raHours: number; decDeg: number } | null {
  const hips = getGroupMemberHips(groupId);
  if (hips.length === 0) return null;

  const byId = getStarByIdMap();
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