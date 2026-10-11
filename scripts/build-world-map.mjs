// بناء خريطة العالم (إسقاط سمتي متساوي المسافات، مركزه القطب الشمالي) كصورة PNG عالية الدقة.
//
// الاستخدام:   node scripts/build-world-map.mjs [--sizes=2048,4096,8192] [--outdir=public/images]
// المتطلبات:   npm i -D @napi-rs/canvas      (لا يحتاج أي بناء native، ولا يحتاج مكتبة topojson)
//
// يحل هذا السكريبت محل build-coastlines.mjs + build-world-map.mjs القديمين. الفروق الجوهرية:
//  1) المصدر: ملفات Natural Earth 10m GeoJSON الأصلية (الملكية العامة) بدقتها الكاملة، بدل
//     world-atlas المُكمَّمة (التي تفقد ~400م من الدقة) والمُقرَّبة إلى 0.001°.
//  2) التكثيف: كل ضلع يُقسَّم إلى أجزاء ≤ STEP درجة قبل الإسقاط، لأن الخط المستقيم في الإحداثيات
//     المسقطة ليس هو الخط الصحيح على الكرة (يظهر خصوصاً عند حافة القارة القطبية الجنوبية).
//  3) معالجة خط التاريخ (±180°) بتوحيد فرق خط الطول قبل التكثيف.
//  4) رسم كل مضلع على حدة بقاعدة evenodd (ثقوب الجزر/البحيرات صحيحة دون تداخل بين المضلعات).
//  5) طبقات إضافية: جزر صغيرة، بحيرات، جليد، حدود دول.
//  6) فحوصات تلقائية بعد الرسم (مدن/محيطات/أقطاب) تفشل السكريبت إن وُجد انحراف.
//  7) مصدر الحقيقة الوحيد: إزاحة غرينتش ومعادلات الإسقاط تُقرأ من src/core/projection.ts نفسه،
//     ويتوقف السكريبت بخطأ صريح إن تغيّرت صيغة الإسقاط هناك — فلا حاجة لأي معايرة يدوية.
//  8) مستويات دقة متعددة (LOD): world-map-2048/4096/8192.png ليختار التطبيق الأنسب لحجم العرض
//     (تصغير صورة 8K إلى ~1000px يُظهر وميضاً في الخطوط الرفيعة؛ المستوى الأصغر يتجنب ذلك).

import { createCanvas } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ───────────────────────────── الإعدادات ─────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const SIZES = String(args.sizes ?? '2048,4096,8192').split(',').map(Number);
const OUT_DIR = args.outdir ?? 'public/images';
const CACHE_DIR = args.cache ?? 'scripts/.cache/natural-earth';
const PROJECTION_TS = args.projection ?? 'src/core/projection.ts';

// ───────── قراءة معاملات الإسقاط من التطبيق نفسه (مصدر الحقيقة الوحيد) ─────────
const projSrc = readFileSync(PROJECTION_TS, 'utf8');
const offsetMatch = projSrc.match(/const\s+GREENWICH_DOWN_OFFSET_DEG\s*=\s*(-?\d+(?:\.\d+)?)\s*;/);
if (!offsetMatch) throw new Error(`لم أجد GREENWICH_DOWN_OFFSET_DEG في ${PROJECTION_TS}`);
const GREENWICH_OFFSET_DEG = Number(offsetMatch[1]);
// حارس: الصيغة التي يفترضها السكريبت يجب أن تكون هي نفسها المستخدمة في latLonToScreen
for (const needle of [
  '(colatitudeDeg / 180) * config.outerRadiusPx',
  '(lonDeg + GREENWICH_DOWN_OFFSET_DEG) * DEG2RAD',
  'config.centerX - r * Math.sin(lonRad)',
  'config.centerY - r * Math.cos(lonRad)',
]) {
  if (!projSrc.includes(needle)) {
    throw new Error(`تغيّرت صيغة الإسقاط في ${PROJECTION_TS} (لم أجد: ${needle}). حدّث دالة project() هنا.`);
  }
}
console.log(`الإسقاط من ${PROJECTION_TS}: إزاحة غرينتش = ${GREENWICH_OFFSET_DEG}°`);

const STEP = 0.25; // أقصى طول ضلع بالدرجات بعد التكثيف

const COLORS = {
  ocean: '#0b2b4a',
  land: '#4f8a5b',
  ice: '#e9eff4',
  lake: '#0b2b4a',
  shore: 'rgba(255,255,255,0.20)',
  border: 'rgba(255,255,255,0.38)',
};

const LAYERS = {
  land: 'ne_10m_land',
  islands: 'ne_10m_minor_islands',
  lakes: 'ne_10m_lakes',
  glaciers: 'ne_10m_glaciated_areas',
  borders: 'ne_10m_admin_0_boundary_lines_land',
};
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

// ───────────────────────────── التحميل ─────────────────────────────
async function loadLayer(name) {
  const file = join(CACHE_DIR, `${name}.geojson`);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    console.log(`تنزيل ${name} ...`);
    const res = await fetch(`${BASE}/${name}.geojson`);
    if (!res.ok) throw new Error(`فشل تنزيل ${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, 'utf8')).features;
}

// ───────────────────────────── الإسقاط ─────────────────────────────
const DEG = Math.PI / 180;
let SIZE = 0; // يُضبط لكل مستوى دقة قبل الرسم
let R = 0;
let C = 0;

/** [lon, lat] بالدرجات → [x, y] بالبكسل. نصف قطر الصورة = نصف قطر القبة (outerRadiusPx) في التطبيق. */
function project(lon, lat) {
  const r = ((90 - lat) / 180) * R;
  const a = (lon + GREENWICH_OFFSET_DEG) * DEG;
  return [C - r * Math.sin(a), C - r * Math.cos(a)];
}

// ───────────────────────────── الرسم ─────────────────────────────
function tracePath(ctx, pts, closed) {
  let [pl, pb] = pts[0];
  ctx.moveTo(...project(pl, pb));
  for (let i = 1; i < pts.length; i++) {
    const [lon, lat] = pts[i];
    let dLon = lon - pl;
    dLon -= 360 * Math.round(dLon / 360); // أقصر مسار عبر خط التاريخ
    const dLat = lat - pb;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dLon), Math.abs(dLat)) / STEP));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      ctx.lineTo(...project(pl + dLon * t, pb + dLat * t));
    }
    pl = lon;
    pb = lat;
  }
  if (closed) ctx.closePath();
}

function polygonsOf(feature) {
  const g = feature.geometry;
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function linesOf(feature) {
  const g = feature.geometry;
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

function fillFeatures(ctx, features, color, filter = () => true) {
  ctx.fillStyle = color;
  for (const f of features) {
    for (const poly of polygonsOf(f)) {
      if (!filter(poly)) continue;
      ctx.beginPath();
      for (const ring of poly) tracePath(ctx, ring, true);
      ctx.fill('evenodd');
    }
  }
}

function strokeFeatures(ctx, features, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const f of features) {
    ctx.beginPath();
    for (const poly of polygonsOf(f)) for (const ring of poly) tracePath(ctx, ring, true);
    for (const line of linesOf(f)) tracePath(ctx, line, false);
    ctx.stroke();
  }
}

const minLat = (poly) => Math.min(...poly[0].map((p) => p[1]));

const t0 = Date.now();
const [land, islands, lakes, glaciers, borders] = await Promise.all(
  Object.values(LAYERS).map(loadLayer),
);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const CHECKS = [
  ['لندن', -0.1, 51.5, 'land'],
  ['موسكو', 37.6, 55.75, 'land'],
  ['القاهرة', 31.2, 30.0, 'land'],
  ['تونس', 9.5, 34.0, 'land'],
  ['الصحراء الكبرى', 13, 23, 'land'],
  ['الأمازون', -62, -5, 'land'],
  ['أستراليا (وسط)', 134, -25, 'land'],
  ['غرينلاند (جليد)', -40, 72, 'ice'],
  ['القطب الجنوبي', 0, -89.9, 'ice'],
  ['القطب الشمالي', 0, 89.9, 'ocean'],
  ['وسط الأطلسي', -40, 30, 'ocean'],
  ['خليج غينيا (0,0)', 0, 0, 'ocean'],
  ['المحيط الهندي', 80, -20, 'ocean'],
  ['وسط الهادئ', -150, 0, 'ocean'],
  ['بحيرة فيكتوريا', 33, -1, 'lake'],
  ['بحر قزوين', 51, 42, 'lake'],
];

mkdirSync(OUT_DIR, { recursive: true });
let failed = 0;

for (const size of SIZES) {
  SIZE = size;
  R = C = size / 2;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const px = SIZE / 8192; // مقياس سماكة الخطوط بالنسبة لدقة 8192
  const w = (v) => Math.max(0.6, v * px); // لا تقل سماكة الخط عن ~0.6px كي لا يختفي في المستويات الصغيرة

  ctx.fillStyle = COLORS.ocean;
  ctx.fillRect(0, 0, SIZE, SIZE);

  fillFeatures(ctx, land, COLORS.land);
  fillFeatures(ctx, islands, COLORS.land);
  // القارة القطبية الجنوبية (~98% جليد): تُلوَّن كلها بلون الجليد
  fillFeatures(ctx, land, COLORS.ice, (poly) => minLat(poly) < -60);
  fillFeatures(ctx, glaciers, COLORS.ice);
  fillFeatures(ctx, lakes, COLORS.lake);

  strokeFeatures(ctx, land, COLORS.shore, w(1.0));
  strokeFeatures(ctx, islands, COLORS.shore, w(1.0));
  strokeFeatures(ctx, borders, COLORS.border, w(0.9));

  // ── فحوصات ذاتية ──
  let levelFailed = 0;
  for (const [name, lon, lat, kind] of CHECKS) {
    const [x, y] = project(lon, lat);
    const d = ctx.getImageData(Math.min(SIZE - 1, Math.round(x)), Math.min(SIZE - 1, Math.round(y)), 1, 1).data;
    if (!near([d[0], d[1], d[2]], hex(COLORS[kind]))) {
      levelFailed++;
      console.log(`  ✗ ${name} (${lat}, ${lon}) → المتوقع ${kind}`);
    }
  }
  failed += levelFailed;

  const out = join(OUT_DIR, `world-map-${size}.png`);
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`${levelFailed ? '✗' : '✓'} ${out} (${size}×${size}) — ${CHECKS.length - levelFailed}/${CHECKS.length} فحص ناجح`);
}

console.log(`\nانتهى خلال ${((Date.now() - t0) / 1000).toFixed(1)} ثانية`);
if (failed) {
  console.error(`✗ فشل ${failed} فحص — راجع بيانات المصدر أو صيغة الإسقاط`);
  process.exit(1);
}
