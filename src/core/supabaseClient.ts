import { createClient } from '@supabase/supabase-js';

// ملاحظة مهمة: في Vite، تُقرأ متغيرات البيئة عبر import.meta.env (وليس process.env كما في
// Next.js)، ولا يُكشف أي متغير للمتصفح إلا إن بدأ اسمه بـVITE_ بالضبط. لهذا يجب أن يحمل
// .env.local الاسمين VITE_SUPABASE_URL وVITE_SUPABASE_ANON_KEY تحديداً.
//
// تحذير أمني: لا تضع مفتاح service_role هنا أو في أي ملف داخل src/ إطلاقاً — أي قيمة هنا
// تُضمَّن في حزمة JavaScript المُرسَلة لكل زائر. المفتاح العام (anon key) فقط هو الآمن
// للاستخدام من طرف المتصفح، ويجب أن تحميه قواعد RLS في قاعدة البيانات نفسها.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // تحذير مبكر وواضح في الطرفية بدل فشل صامت لاحقاً عند أول استعلام
  // eslint-disable-next-line no-console
  console.error(
    'إعداد Supabase ناقص: تأكد أن .env.local يحتوي VITE_SUPABASE_URL وVITE_SUPABASE_ANON_KEY، ثم أعد تشغيل npm run dev (Vite لا يعيد قراءة .env تلقائياً أثناء التشغيل).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
/**
 * يجلب كل صفوف جدول على دفعات: Supabase يقصّ أي استعلام عند 1000 صف افتراضياً دون أي خطأ،
 * وجدولا group_stars وgroup_lines يتجاوزان ذلك، فكانت بعض الكوكبات تُرسم ناقصة بصمت.
 * orderBy يجب أن يكون فريداً (أو مركّباً) ليبقى الترقيم الصفحي ثابتاً.
 */
export async function fetchAllRows<T>(
  table: string,
  columns: string,
  orderBy: string[],
  opts: { notNull?: string; pageSize?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(columns);
    if (opts.notNull) q = q.not(opts.notNull, 'is', null);
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}