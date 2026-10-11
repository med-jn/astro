// توليد البيانات المتجهية التي يرسمها التطبيق مباشرة عند التقريب (التكبير > ~4x)، حيث لا تكفي
// صورة الخريطة الجاهزة (8K ≈ 4.9 كم/بكسل، أي أن جزيرة بحجم جربة ≈ 6 بكسل فقط).
//
// الاستخدام:   node scripts/build-vector-data.mjs
// المدخلات:    ملفات Natural Earth 10m GeoJSON في scripts/.cache/natural-earth (تُنزَّل تلقائياً إن غابت)
//              — نفس الملفات التي يستخدمها build-world-map.mjs، فتتطابق الصورة والمتجهات هندسياً.
// المخرجات:    public/data/earth-vector.bin  (يابسة + جزر + جليد + بحيرات + حدود دول)
//              public/data/timezones.bin     (حدود المناطق الزمنية الفعلية، تُحمَّل عند طلبها فقط)
//
// صيغة الملف (بعد فك gzip):
//   'N' 'V' '1'  | u8 عدد الطبقات
//   لكل طبقة:    u8 المعرّف | u8 النوع (0 = مضلعات، 1 = خطوط) | varint عدد العناصر
//     مضلع:      varint عدد الحلقات، ولكل حلقة: varint عدد النقاط ثم (lon,lat) كفروق zigzag-varint
//     خط:        varint عدد النقاط ثم (lon,lat) كفروق zigzag-varint
//   الإحداثيات مُكمَّمة بوحدة 1e-4° (≈ 11 م، أي خطأ ≤ 5.5 م) — أدق بكثير من دقة المصدر نفسه.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const CACHE_DIR = 'scripts/.cache/natural-earth';
const OUT_DIR = 'public/data';
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const Q = 1e4; // وحدات لكل درجة

const LAYER_IDS = { land: 1, glaciers: 2, lakes: 3, borders: 4, timezones: 5 };

async function loadFeatures(name) {
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

// ───────── ترميز ─────────
class ByteWriter {
  constructor() { this.buf = Buffer.alloc(1 << 20); this.len = 0; }
  ensure(n) { if (this.len + n > this.buf.length) { const nb = Buffer.alloc(Math.max(this.buf.length * 2, this.len + n)); this.buf.copy(nb, 0, 0, this.len); this.buf = nb; } }
  u8(v) { this.ensure(1); this.buf[this.len++] = v; }
  varint(v) { this.ensure(5); while (v >= 128) { this.buf[this.len++] = (v % 128) | 128; v = Math.floor(v / 128); } this.buf[this.len++] = v; }
  zigzag(i) { this.varint(i < 0 ? -2 * i - 1 : 2 * i); }
  bytes() { return this.buf.subarray(0, this.len); }
}

function writeCoords(w, coords) {
  w.varint(coords.length);
  let pLon = 0, pLat = 0;
  for (const [lon, lat] of coords) {
    const qLon = Math.round(lon * Q), qLat = Math.round(lat * Q);
    w.zigzag(qLon - pLon); w.zigzag(qLat - pLat);
    pLon = qLon; pLat = qLat;
  }
}

function polygonsOf(f) {
  const g = f.geometry;
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}
function linesOf(f) {
  const g = f.geometry;
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

function encode(layers) {
  const w = new ByteWriter();
  w.u8(0x4e); w.u8(0x56); w.u8(0x31); // 'NV1'
  w.u8(layers.length);
  for (const { id, kind, items } of layers) {
    w.u8(id); w.u8(kind === 'polygons' ? 0 : 1); w.varint(items.length);
    for (const item of items) {
      if (kind === 'polygons') { w.varint(item.length); for (const ring of item) writeCoords(w, ring); }
      else writeCoords(w, item);
    }
  }
  return gzipSync(w.bytes(), { level: 9 });
}

function write(name, layers) {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = encode(layers);
  const path = join(OUT_DIR, name);
  writeFileSync(path, out);
  const pts = layers.reduce((n, l) => n + l.items.reduce((m, it) => m + (l.kind === 'polygons' ? it.reduce((k, r) => k + r.length, 0) : it.length), 0), 0);
  console.log(`✓ ${path}  ${(out.length / 1048576).toFixed(2)} MB  (${pts.toLocaleString()} نقطة)`);
}

const [land, islands, glaciers, lakes, borders, tz] = await Promise.all([
  loadFeatures('ne_10m_land'), loadFeatures('ne_10m_minor_islands'), loadFeatures('ne_10m_glaciated_areas'),
  loadFeatures('ne_10m_lakes'), loadFeatures('ne_10m_admin_0_boundary_lines_land'), loadFeatures('ne_10m_time_zones'),
]);

write('earth-vector.bin', [
  { id: LAYER_IDS.land, kind: 'polygons', items: [...land, ...islands].flatMap(polygonsOf) },
  { id: LAYER_IDS.glaciers, kind: 'polygons', items: glaciers.flatMap(polygonsOf) },
  { id: LAYER_IDS.lakes, kind: 'polygons', items: lakes.flatMap(polygonsOf) },
  { id: LAYER_IDS.borders, kind: 'lines', items: borders.flatMap(linesOf) },
]);
write('timezones.bin', [{ id: LAYER_IDS.timezones, kind: 'polygons', items: tz.flatMap(polygonsOf) }]);
