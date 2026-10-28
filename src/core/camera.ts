/**
 * كاميرا «عين الراصد»: اتجاه نظر (سمت، ارتفاع، لفّ) ومجال رؤية وإسقاط، فوق إحداثيات الراصد المحلية (شرق، شمال، أعلى).
 *
 * ثلاثة إسقاطات (نصف قطر الصورة r مقابل الزاوية θ عن محور النظر):
 *   • stereographic (الافتراضي): r = 2f·tan(θ/2) — مطابِق (يحفظ الأشكال الصغيرة) ويتّسع حتى ما فوق 180° (يعرض السماء كلها).
 *   • perspective: r = f·tan θ — كالكاميرا الفوتوغرافية، الخطوط المستقيمة تبقى مستقيمة، لمجالات الرؤية الضيقة.
 *   • equidistant: r = f·θ — تساوي المسافة الزاوية، لمجالات رؤية واسعة جداً.
 * مجال الرؤية fov هو الزاوية الممتدة على أصغر بُعدي الشاشة (فيبقى معنى الرقم ثابتاً بين الطول والعرض).
 */
export type ProjectionKind = 'stereographic' | 'perspective' | 'equidistant';
/** اتجاه محلي: [شرق، شمال، أعلى] */
export type V3 = [number, number, number];

export interface Camera {
  azDeg: number;
  altDeg: number;
  rollDeg: number;
  fovDeg: number;
  projection: ProjectionKind;
}

/** عين الراصد: منظوري (الأفق مستقيم كما تراه العين)، متجهاً جنوباً بمجال 70° */
export const DEFAULT_CAMERA: Camera = { azDeg: 180, altDeg: 12, rollDeg: 0, fovDeg: 46, projection: 'perspective' };

const DEG = Math.PI / 180;
const FOV_LIMITS: Record<ProjectionKind, [number, number]> = {
  stereographic: [0.05, 220],
  perspective: [0.05, 100], // أوسع من ذلك يمطّ الأطراف (عدسة بزاوية فائقة)؛ للمجال الأوسع استعمل المجسّم
  equidistant: [0.05, 360],
};
export const fovLimits = (p: ProjectionKind) => FOV_LIMITS[p];

export function clampCamera(c: Camera): Camera {
  const [lo, hi] = FOV_LIMITS[c.projection];
  let az = c.azDeg % 360; if (az < 0) az += 360;
  let roll = c.rollDeg % 360; if (roll > 180) roll -= 360; if (roll < -180) roll += 360;
  return { ...c, azDeg: az, altDeg: Math.max(-90, Math.min(90, c.altDeg)), rollDeg: roll, fovDeg: Math.max(lo, Math.min(hi, c.fovDeg)) };
}

/** اتجاه من (ارتفاع، سمت) بالدرجات */
export function dirFromAltAz(altDeg: number, azDeg: number): V3 {
  const a = altDeg * DEG, z = azDeg * DEG;
  return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)];
}
export function altAzFromDir(d: V3): { altDeg: number; azDeg: number } {
  const alt = Math.asin(Math.max(-1, Math.min(1, d[2]))) / DEG;
  let az = Math.atan2(d[0], d[1]) / DEG; if (az < 0) az += 360;
  return { altDeg: alt, azDeg: az };
}

export interface Basis { right: V3; up: V3; fwd: V3 }
export function cameraBasis(c: Camera): Basis {
  const fwd = dirFromAltAz(c.altDeg, c.azDeg);
  const az = c.azDeg * DEG, al = c.altDeg * DEG, r = c.rollDeg * DEG;
  const right0: V3 = [Math.cos(az), -Math.sin(az), 0];
  const up0: V3 = [-Math.sin(al) * Math.sin(az), -Math.sin(al) * Math.cos(az), Math.cos(al)];
  const cr = Math.cos(r), sr = Math.sin(r);
  return {
    fwd,
    right: [right0[0] * cr + up0[0] * sr, right0[1] * cr + up0[1] * sr, right0[2] * cr + up0[2] * sr],
    up: [-right0[0] * sr + up0[0] * cr, -right0[1] * sr + up0[1] * cr, -right0[2] * sr + up0[2] * cr],
  };
}

export interface Projector {
  w: number; h: number; f: number; basis: Basis; camera: Camera;
  /** يكتب (x, y) على الشاشة (بكسل) ويعيد true إن كان الاتجاه قابلاً للإسقاط (أمام الكاميرا للإسقاط المنظوري) */
  project(d: V3, out: { x: number; y: number }): boolean;
  /** الاتجاه المحلي عند نقطة شاشة */
  unproject(sx: number, sy: number): V3;
  /** كـ unproject لكن يكتب في out (بلا تخصيص ذاكرة، لحلقات البكسل) */
  unprojectInto(sx: number, sy: number, out: V3): void;
  /** بكسل لكل راديان محلياً عند اتجاه (لتحويل الأقطار الزاوية إلى بكسل) */
  scaleAt(d: V3): number;
}

export function makeProjector(camera: Camera, w: number, h: number): Projector {
  const c = clampCamera(camera);
  const basis = cameraBasis(c);
  const half = Math.min(w, h) / 2;
  const fov = c.fovDeg * DEG;
  const f = c.projection === 'stereographic' ? half / (2 * Math.tan(fov / 4))
    : c.projection === 'perspective' ? half / Math.tan(fov / 2)
    : half / (fov / 2);
  const { right, up, fwd } = basis;
  const kind = c.projection;

  const project = (d: V3, out: { x: number; y: number }): boolean => {
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    let X: number, Y: number;
    if (kind === 'stereographic') {
      const den = 1 + z;
      if (den < 1e-5) return false;
      X = (2 * f * x) / den; Y = (2 * f * y) / den;
    } else if (kind === 'perspective') {
      if (z < 1e-4) return false;
      X = (f * x) / z; Y = (f * y) / z;
    } else {
      const s = Math.hypot(x, y);
      const th = Math.acos(Math.max(-1, Math.min(1, z)));
      if (s < 1e-12) { X = 0; Y = 0; } else { X = (f * th * x) / s; Y = (f * th * y) / s; }
    }
    out.x = w / 2 + X; out.y = h / 2 - Y;
    return true;
  };

  const unprojectInto = (sx: number, sy: number, out: V3): void => {
    const X = sx - w / 2, Y = h / 2 - sy;
    let x: number, y: number, z: number;
    if (kind === 'stereographic') {
      const t = Math.hypot(X, Y) / (2 * f);
      const den = 1 + t * t, s = (2 * t) / den;
      z = (1 - t * t) / den;
      const r = Math.hypot(X, Y) || 1;
      x = (X / r) * s; y = (Y / r) * s;
    } else if (kind === 'perspective') {
      x = X / f; y = Y / f; z = 1;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    } else {
      const r = Math.hypot(X, Y);
      const th = r / f;
      const s = Math.sin(th);
      z = Math.cos(th);
      x = r < 1e-9 ? 0 : (X / r) * s; y = r < 1e-9 ? 0 : (Y / r) * s;
    }
    out[0] = right[0] * x + up[0] * y + fwd[0] * z;
    out[1] = right[1] * x + up[1] * y + fwd[1] * z;
    out[2] = right[2] * x + up[2] * y + fwd[2] * z;
  };
  const unproject = (sx: number, sy: number): V3 => { const o: V3 = [0, 0, 0]; unprojectInto(sx, sy, o); return o; };

  const p0 = { x: 0, y: 0 }, p1 = { x: 0, y: 0 };
  const scaleAt = (d: V3): number => {
    // متجه عمودي على d (من جداء مع محور الكاميرا الأعلى أو الأيمن)
    let t: V3 = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
    let l = Math.hypot(t[0], t[1], t[2]);
    if (l < 1e-6) { t = [d[1] * right[2] - d[2] * right[1], d[2] * right[0] - d[0] * right[2], d[0] * right[1] - d[1] * right[0]]; l = Math.hypot(t[0], t[1], t[2]); }
    const eps = 1e-3;
    const d2: V3 = [d[0] + (t[0] / l) * eps, d[1] + (t[1] / l) * eps, d[2] + (t[2] / l) * eps];
    const m = Math.hypot(d2[0], d2[1], d2[2]); d2[0] /= m; d2[1] /= m; d2[2] /= m;
    if (!project(d, p0) || !project(d2, p1)) return f;
    return Math.hypot(p1.x - p0.x, p1.y - p0.y) / eps;
  };

  return { w, h, f, basis, camera: c, project, unproject, unprojectInto, scaleAt };
}

/**
 * السحب: يحرّك النظر بما يطابق إزاحة الإصبع عند مركز الشاشة (بكسل → زاوية بقسمة على f).
 * يقسم الدوران الأفقي على cos(الارتفاع) كي لا «يتباطأ» السحب قرب السمت، مع سقف لتفادي الانفجار عند القطب.
 */
export function dragCamera(c: Camera, dxPx: number, dyPx: number, f: number): Camera {
  const perPx = 1 / f / DEG; // درجات لكل بكسل عند المركز (للإسقاط المجسّم والمنظوري عند المركز)
  const cosAlt = Math.max(0.2, Math.cos(c.altDeg * DEG));
  const r = c.rollDeg * DEG;
  // نُدوّر إزاحة الشاشة بعكس اللفّ لتصير في إطار الأفق
  const dx = dxPx * Math.cos(r) - dyPx * Math.sin(r);
  const dy = dxPx * Math.sin(r) + dyPx * Math.cos(r);
  return clampCamera({ ...c, azDeg: c.azDeg - (dx * perPx) / cosAlt, altDeg: c.altDeg + dy * perPx });
}

/** تكبير مع الإبقاء على النقطة تحت المؤشر في مكانها قدر الإمكان (يعدّل fov ثم يعيد توجيه النظر) */
export function zoomCameraAt(c: Camera, factor: number, sx: number, sy: number, w: number, h: number): Camera {
  const anchor = makeProjector(c, w, h).unproject(sx, sy);
  const target = altAzFromDir(anchor);
  let nc = clampCamera({ ...c, fovDeg: c.fovDeg / factor });
  // تصحيح تكراري: نُدير النظر بفرق الاتجاه بين ما يقع تحت المؤشر الآن وما كان تحته (يتقارب في 3 خطوات حتى عند حافة الشاشة)
  for (let i = 0; i < 4; i++) {
    const now = altAzFromDir(makeProjector(nc, w, h).unproject(sx, sy));
    let dAz = target.azDeg - now.azDeg; if (dAz > 180) dAz -= 360; if (dAz < -180) dAz += 360;
    nc = clampCamera({ ...nc, azDeg: nc.azDeg + dAz, altDeg: nc.altDeg + (target.altDeg - now.altDeg) });
  }
  return nc;
}
