/**
 * رسم الخريطة متجهياً مباشرةً عند التقريب (دقة غير محدودة بالبكسل).
 *
 * صورة 8K تغطي القرص كله بدقة ≈ 4.9 كم/بكسل، فلا تُظهر جزيرة بحجم جربة (~25 كم) إلا بنحو 6 بكسل.
 * لذلك يرسم التطبيق السواحل والجزر والبحيرات والجليد والحدود من بيانات Natural Earth 10m مباشرةً
 * عندما يزيد التكبير عن ~4x، ويبقى الاعتماد على الصورة فقط عند التصغير (خفيف وسريع).
 *
 * البيانات تُولَّد بـ scripts/build-vector-data.mjs وتُحمَّل مرة واحدة وعند الحاجة فقط:
 *   public/data/earth-vector.bin  (~2.5MB)   public/data/timezones.bin  (~0.4MB)
 *
 * كل النقاط تُحوَّل مرة واحدة إلى إحداثيات "قرص الوحدة" (نصف القطر = 1، المركز = 0) بنفس معادلة
 * latLonToScreen تماماً (الثابت GREENWICH_DOWN_OFFSET_DEG مستورَد من projection.ts)، فلا يمكن أن
 * تنحرف عن بقية الطبقات. أما الرسم فمضروب بنصف القطر الحالي، ومُقتطَع بالمشهد المرئي فقط.
 */
import { GREENWICH_DOWN_OFFSET_DEG, type PolarMapConfig } from './projection';

const DEG = Math.PI / 180;
const QUANT = 1e4; // يجب أن يطابق Q في build-vector-data.mjs

/** مطابقة لألوان build-world-map.mjs حتى لا يظهر فرق عند الانتقال من الصورة إلى المتجهات */
export const VECTOR_COLORS = {
  ocean: '#0b2b4a',
  land: '#4f8a5b',
  ice: '#e9eff4',
  lake: '#0b2b4a',
  shore: 'rgba(255,255,255,0.20)',
  border: 'rgba(255,255,255,0.38)',
};

const LAYER = { land: 1, glaciers: 2, lakes: 3, borders: 4, timezones: 5 } as const;

/** مضلع/خط بإحداثيات قرص الوحدة (x,y متتابعة) مع صندوقه المحيط للاستبعاد السريع */
interface Ring {
  xy: Float32Array;
  minX: number; minY: number; maxX: number; maxY: number;
}
interface Poly {
  rings: Ring[];
  /** أدنى خط عرض للحلقة الخارجية (للتعرف على القارة القطبية الجنوبية) */
  minLat: number;
  minX: number; minY: number; maxX: number; maxY: number;
}
interface Line {
  ring: Ring;
}

export interface VectorLayers {
  land: Poly[];
  glaciers: Poly[];
  lakes: Poly[];
  borders: Line[];
  timezones: Poly[];
}

// ───────────────────────────── فك الترميز ─────────────────────────────
class Reader {
  pos = 0;
  constructor(readonly b: Uint8Array) {}
  u8(): number { return this.b[this.pos++]; }
  varint(): number {
    let r = 0, m = 1, byte: number;
    do { byte = this.b[this.pos++]; r += (byte & 127) * m; m *= 128; } while (byte & 128);
    return r;
  }
  zigzag(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }
}

function readRing(rd: Reader): { ring: Ring; minLat: number } {
  const n = rd.varint();
  const xy = new Float32Array(n * 2);
  let qLon = 0, qLat = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minLat = 90;
  for (let i = 0; i < n; i++) {
    qLon += rd.zigzag();
    qLat += rd.zigzag();
    const lat = qLat / QUANT;
    const r = (90 - lat) / 180;
    const a = (qLon / QUANT + GREENWICH_DOWN_OFFSET_DEG) * DEG;
    const x = -r * Math.sin(a);
    const y = -r * Math.cos(a);
    xy[2 * i] = x;
    xy[2 * i + 1] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (lat < minLat) minLat = lat;
  }
  return { ring: { xy, minX, minY, maxX, maxY }, minLat };
}

export function decodeVectorData(bytes: Uint8Array): Partial<VectorLayers> {
  const rd = new Reader(bytes);
  if (rd.u8() !== 0x4e || rd.u8() !== 0x56 || rd.u8() !== 0x31) throw new Error('ملف بيانات متجهية غير صالح');
  const out: Partial<VectorLayers> = {};
  const layerCount = rd.u8();
  for (let l = 0; l < layerCount; l++) {
    const id = rd.u8();
    const kind = rd.u8();
    const count = rd.varint();
    if (kind === 0) {
      const polys: Poly[] = [];
      for (let i = 0; i < count; i++) {
        const ringCount = rd.varint();
        const rings: Ring[] = [];
        let minLat = 90;
        for (let k = 0; k < ringCount; k++) {
          const { ring, minLat: ml } = readRing(rd);
          rings.push(ring);
          if (k === 0) minLat = ml;
        }
        const o = rings[0];
        polys.push({ rings, minLat, minX: o.minX, minY: o.minY, maxX: o.maxX, maxY: o.maxY });
      }
      if (id === LAYER.land) out.land = polys;
      else if (id === LAYER.glaciers) out.glaciers = polys;
      else if (id === LAYER.lakes) out.lakes = polys;
      else if (id === LAYER.timezones) out.timezones = polys;
    } else {
      const lines: Line[] = [];
      for (let i = 0; i < count; i++) lines.push({ ring: readRing(rd).ring });
      if (id === LAYER.borders) out.borders = lines;
    }
  }
  return out;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`فشل تحميل ${url}: ${res.status}`);
  let buf = new Uint8Array(await res.arrayBuffer());
  // الملف مضغوط gzip؛ بعض الخوادم تفكّه تلقائياً (Content-Encoding) فنفحص البصمة أولاً
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return buf;
}

// ───────────────────────────── حالة التحميل ─────────────────────────────
let earth: Pick<VectorLayers, 'land' | 'glaciers' | 'lakes' | 'borders'> | null = null;
let earthState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let zones: Poly[] | null = null;
let zonesState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

/** يبدأ تحميل بيانات الأرض مرة واحدة (آمن للاستدعاء كل إطار) */
export function ensureEarthVectorLoading(): void {
  if (earthState !== 'idle') return;
  earthState = 'loading';
  fetchBytes(`${import.meta.env.BASE_URL}data/earth-vector.bin`)
    .then((b) => {
      const d = decodeVectorData(b);
      earth = { land: d.land ?? [], glaciers: d.glaciers ?? [], lakes: d.lakes ?? [], borders: d.borders ?? [] };
      earthState = 'ready';
    })
    .catch((e) => { console.error(e); earthState = 'error'; });
}

export function isEarthVectorReady(): boolean {
  return earthState === 'ready';
}

/** يبدأ تحميل حدود المناطق الزمنية الفعلية عند أول طلب لها فقط */
export function ensureTimeZonesLoading(): void {
  if (zonesState !== 'idle') return;
  zonesState = 'loading';
  fetchBytes(`${import.meta.env.BASE_URL}data/timezones.bin`)
    .then((b) => { zones = decodeVectorData(b).timezones ?? []; zonesState = 'ready'; })
    .catch((e) => { console.error(e); zonesState = 'error'; });
}

export function isTimeZonesReady(): boolean {
  return zonesState === 'ready';
}

/** لأغراض الاختبار فقط: حقن بيانات مفكوكة دون شبكة */
export function __setVectorDataForTest(e: Partial<VectorLayers>): void {
  if (e.land) {
    earth = { land: e.land, glaciers: e.glaciers ?? [], lakes: e.lakes ?? [], borders: e.borders ?? [] };
    earthState = 'ready';
  }
  if (e.timezones) { zones = e.timezones; zonesState = 'ready'; }
}

// ───────────────────────────── الرسم ─────────────────────────────
export interface ViewportInfo {
  width: number;
  height: number;
  sceneRotationDeg: number;
  panXpx: number;
  panYpx: number;
}

export interface ViewRect {
  /** المشهد المرئي في إطار الإحداثيات الذي تُرسم فيه الطبقات (قبل التحويل المدوَّر) */
  x0: number; y0: number; x1: number; y1: number;
  /** المشهد نفسه بإحداثيات قرص الوحدة */
  u0: number; v0: number; u1: number; v1: number;
}

/** المشهد المرئي بإطار الرسم = معكوس translate(pan)·translate(c)·rotate(θ)·translate(−c) على أركان الكانفس */
export function computeViewRect(config: PolarMapConfig, vp: ViewportInfo, marginPx: number): ViewRect {
  const th = vp.sceneRotationDeg * DEG;
  const c = Math.cos(th), s = Math.sin(th);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[0, 0], [vp.width, 0], [0, vp.height], [vp.width, vp.height]]) {
    const vx = sx - vp.panXpx - config.centerX;
    const vy = sy - vp.panYpx - config.centerY;
    const x = config.centerX + vx * c + vy * s;
    const y = config.centerY - vx * s + vy * c;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  x0 -= marginPx; y0 -= marginPx; x1 += marginPx; y1 += marginPx;
  const R = config.outerRadiusPx;
  return {
    x0, y0, x1, y1,
    u0: (x0 - config.centerX) / R, v0: (y0 - config.centerY) / R,
    u1: (x1 - config.centerX) / R, v1: (y1 - config.centerY) / R,
  };
}

let outcodes = new Uint8Array(1 << 16);
let minStepSq = 0.12; // نتجاهل نقاطاً أقرب من ~0.35px للنقطة السابقة (لا تغيّر شيئاً مرئياً)

let minPolyPx = 0.5; // مضلعات أصغر من هذا (بكسل) لا تُرى فنتجاوزها

/** لأغراض الاختبار فقط */
export function __setMinStepForTest(sq: number, polyPx = 0.5): void {
  minStepSq = sq;
  minPolyPx = polyPx;
}

/**
 * يضيف حلقة/خطاً إلى المسار مع استبعاد النقاط التي لا تؤثر على المشهد المرئي.
 *
 * تُحذف النقطة i فقط إذا اشترك في نصف مستوى خارجي واحد كلٌّ من: آخر نقطة *رُسمت فعلاً*، والنقطة i،
 * والنقطة التالية. المقارنة بآخر نقطة مرسومة (لا بالجارة الأصلية) ضرورية: بدونها يمكن حذف سلسلة
 * نقاط تدور حول زاوية المشهد خارجه فيتحول المسار إلى وتر مستقيم يعبر الشاشة (وهذا ما كشفه الاختبار).
 * بهذا الشرط يشترك طرفا كل وتر بديل في نصف مستوى خارجي، فلا يمس المشهد المرئي ولا يغيّر تعبئته.
 */
function traceRing(
  path: CanvasPath, ring: Ring, closed: boolean,
  cx: number, cy: number, R: number, v: ViewRect
): void {
  const xy = ring.xy;
  const n = xy.length >> 1;
  if (n < 2) return;
  if (outcodes.length < n) outcodes = new Uint8Array(n * 2);
  const oc = outcodes;
  for (let i = 0; i < n; i++) {
    const x = cx + xy[2 * i] * R;
    const y = cy + xy[2 * i + 1] * R;
    oc[i] = (x < v.x0 ? 1 : 0) | (x > v.x1 ? 2 : 0) | (y < v.y0 ? 4 : 0) | (y > v.y1 ? 8 : 0);
  }
  let started = false;
  let lx = 0, ly = 0, lastOc = 0;
  for (let i = 0; i < n; i++) {
    if (started && i < n - 1 && (lastOc & oc[i] & oc[i + 1]) !== 0) continue;
    const x = cx + xy[2 * i] * R;
    const y = cy + xy[2 * i + 1] * R;
    if (!started) {
      path.moveTo(x, y);
      started = true;
    } else {
      const dx = x - lx, dy = y - ly;
      if (dx * dx + dy * dy < minStepSq && i < n - 1) continue;
      path.lineTo(x, y);
    }
    lx = x;
    ly = y;
    lastOc = oc[i];
  }
  if (closed) path.closePath();
}

function disjoint(b: { minX: number; minY: number; maxX: number; maxY: number }, v: ViewRect): boolean {
  return b.maxX < v.u0 || b.minX > v.u1 || b.maxY < v.v0 || b.minY > v.v1;
}

function fillPolys(
  ctx: CanvasRenderingContext2D, polys: Poly[], config: PolarMapConfig, v: ViewRect,
  color: (p: Poly) => string, stroke: boolean
): void {
  const { centerX: cx, centerY: cy, outerRadiusPx: R } = config;
  for (const p of polys) {
    if (disjoint(p, v)) continue;
    if (Math.max(p.maxX - p.minX, p.maxY - p.minY) * R < minPolyPx) continue;
    ctx.beginPath();
    for (const ring of p.rings) traceRing(ctx, ring, true, cx, cy, R, v);
    ctx.fillStyle = color(p);
    ctx.fill('evenodd');
    if (stroke) ctx.stroke();
  }
}

/** يرسم المحيط واليابسة والجليد والبحيرات والحدود متجهياً. alpha < 1 للانتقال التدريجي من الصورة. */
export function drawEarthVector(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, vp: ViewportInfo, alpha = 1
): void {
  if (!earth) return;
  const v = computeViewRect(config, vp, 8);
  const { centerX: cx, centerY: cy, outerRadiusPx: R } = config;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.fillStyle = VECTOR_COLORS.ocean;
  ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);

  ctx.strokeStyle = VECTOR_COLORS.shore;
  ctx.lineWidth = 1;
  fillPolys(ctx, earth.land, config, v, (p) => (p.minLat < -60 ? VECTOR_COLORS.ice : VECTOR_COLORS.land), true);
  fillPolys(ctx, earth.glaciers, config, v, () => VECTOR_COLORS.ice, false);
  fillPolys(ctx, earth.lakes, config, v, () => VECTOR_COLORS.lake, false);

  ctx.strokeStyle = VECTOR_COLORS.border;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (const l of earth.borders) {
    if (disjoint(l.ring, v)) continue;
    traceRing(ctx, l.ring, false, cx, cy, R, v);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * حدود المناطق الزمنية الفعلية. تعيد false إن لم تكتمل بيانات التحميل بعد
 * (فيرسم المستدعي بديلاً مؤقتاً، مثل خطوط الـ15° الاسمية).
 */
export function drawTimeZoneBoundaries(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, vp: ViewportInfo,
  color: string, lineWidth: number
): boolean {
  if (!zones) return false;
  const v = computeViewRect(config, vp, 8);
  const { centerX: cx, centerY: cy, outerRadiusPx: R } = config;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const p of zones) {
    if (disjoint(p, v)) continue;
    for (const ring of p.rings) traceRing(ctx, ring, true, cx, cy, R, v);
  }
  ctx.stroke();
  ctx.restore();
  return true;
}

// ───────────────────────────── تخزين مؤقت + رسم متكيّف ─────────────────────────────
/** إن تجاوزت كلفة رسم الطبقة هذا الحد (مللي ثانية) نؤجّل رسمها أثناء الحركة ونعرض الصورة بدلاً منها */
const BUDGET_MS = 14;
/** مدة ثبات العرض (مللي ثانية) قبل رسم المتجه الثقيل بعد انتهاء الحركة */
const SETTLE_MS = 160;

let layerCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let layerKey = '';
let seenKey = '';
let seenAt = 0;
let costMs = 0;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * يرسم الطبقة المتجهية مع تخزين مؤقت: ما دام التحويل (إزاحة/تدوير/تكبير/حجم) لم يتغير — كما في
 * حالة تقدّم الزمن فقط — تُنسخ الصورة المخزّنة بلا أي إعادة رسم. وأثناء الحركة، إن كانت كلفة الرسم
 * مرتفعة (مشاهد قارية واسعة) نستعمل `drawRaster` مؤقتاً ثم نرسم المتجه بعد ثبات العرض.
 * `drawRaster` يُستدعى أيضاً تحت المتجهات أثناء الانتقال التدريجي (alpha < 1).
 */
export function drawEarthVectorSmart(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, vp: ViewportInfo,
  alpha: number, drawRaster: () => void
): void {
  if (!earth) { drawRaster(); return; }
  const m = ctx.getTransform();
  const key = [m.a, m.b, m.c, m.d, m.e, m.f, config.outerRadiusPx, vp.width, vp.height]
    .map((n) => n.toFixed(3)).join('|') + `|${ctx.canvas.width}x${ctx.canvas.height}`;
  const now = performance.now();

  let useVector = layerCanvas !== null && layerKey === key;
  if (!useVector) {
    if (key !== seenKey) { seenKey = key; seenAt = now; }
    const moving = now - seenAt < SETTLE_MS;
    if (!(costMs > BUDGET_MS && moving)) {
      const w = ctx.canvas.width, h = ctx.canvas.height;
      if (!layerCanvas || layerCanvas.width !== w || layerCanvas.height !== h) layerCanvas = makeCanvas(w, h);
      const lc = layerCanvas.getContext('2d') as CanvasRenderingContext2D;
      const t0 = performance.now();
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.clearRect(0, 0, w, h);
      lc.setTransform(m);
      drawEarthVector(lc, config, vp, 1);
      const took = performance.now() - t0;
      costMs = costMs === 0 ? took : costMs * 0.5 + took * 0.5;
      layerKey = key;
      useVector = true;
    }
  }

  if (!useVector || alpha < 1) drawRaster();
  if (useVector && layerCanvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // الطبقة المخزّنة بإحداثيات الجهاز؛ قصّ القرص الحالي يبقى ساريًا
    ctx.globalAlpha = alpha;
    ctx.drawImage(layerCanvas as CanvasImageSource, 0, 0);
    ctx.restore();
  }
}
