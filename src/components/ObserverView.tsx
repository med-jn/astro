import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, X } from 'lucide-react';
import * as Astronomy from 'astronomy-engine';
import { useSimulationStore } from '../state/store';
import { useEyeStore, type LookKind, type TrackTarget } from '../state/eye';
import { getLoadedZodiac } from '../core/zodiac';
import { getAllLunarMansions } from '../core/mansions';
import { eclipticLongitudeToEquatorial } from '../core/eclipticTransform';
import { getStarByIdMap } from '../core/starCatalog';
import { makeSkyFrame, placeRaDecJ2000 } from '../core/skyModel';
import { useI18n, type TKey } from '../i18n';
import { groupName, JUPITER_MOON_NAMES, mansionName, zodiacName } from '../i18n/names';
import { getZodiacNameAr } from '../core/zodiacNamesAr';
import { ZODIAC_ORDER, type ZodiacKey } from '../core/zodiac';
import { computeGroupCenter, getGroupMemberHips } from '../core/starGroups';
import { magnificationAt, fovForMagnification } from '../render/eyeScale';
import { selectionTarget } from '../render/eyeSelection';
import type { PlanetPhys } from '../render/eyePlanets';
import { PLANET_LABELS_AR, getAllPlanetStates, getGMSTDeg, getMoonState, getSunState } from '../core/bodies';
import { getMeanObliquityDeg } from '../core/eclipticTransform';
import { DEFAULT_CAMERA, clampCamera, dirFromAltAz, dragCamera, fovLimits, makeProjector, zoomCameraAt, type Camera, type V3 } from '../core/camera';
import { getGpuStamp } from '../render/eyeBackground';
import { renderEye, type EyeInput, type EyeStates, type EyeTarget, type SundialReadout } from '../render/eyeRenderer';
import { drawMoon, drawPlanetDot, type RenderOutput } from '../render/skyRenderer';
import type { ObserverLocation, PlanetName } from '../types/astro';

/* ------------------------------------------------------------------ */
/*  عين الراصد: مشهد الراصد الواقف على الأرض (سماء فوق، أرض تحت) داخل منطقة العرض. */
/*  لا أدوات تحكم هنا: الزمن والموقع والطبقات والإبرازات من لوحة التحكم الرئيسية،  */
/*  والكاميرا والإسقاط والطبقات الخاصة من قسم «عين الراصد» في اللوحة (state/eye).   */
/* ------------------------------------------------------------------ */
const EYE_HEIGHT_M = 1.7;
const DIAL_DISTANCE_M = 4.2; // مركز الساعة الشمسية جنوب الراصد (انظر eyeRenderer)
const CARDINAL_KEYS: TKey[] = ['eye_c_n', 'eye_c_ne', 'eye_c_e', 'eye_c_se', 'eye_c_s', 'eye_c_sw', 'eye_c_w', 'eye_c_nw'];

interface Hud { az: number; alt: number; fov: number; mag: number; sundial: SundialReadout | null }
interface Card { name: string; detail: string }
interface Tween { az0: number; alt0: number; fov0: number; az1: number; alt1: number; fov1: number; t0: number }
const LOOK_CODES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const ZOOM_IN_CODES = ['Equal', 'NumpadAdd', 'PageUp'];
const ZOOM_OUT_CODES = ['Minus', 'NumpadSubtract', 'PageDown'];
const HOLD_CODES = [...LOOK_CODES, ...ZOOM_IN_CODES, ...ZOOM_OUT_CODES];

const PLANET_BODIES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'] as const;
/** المسافة والطور ومحور الدوران وأقمار المشتري من astronomy-engine (للقرص والحلقات والأقمار في العين) */
function computePhysical(time: ReturnType<typeof Astronomy.MakeTime>): Record<string, PlanetPhys> | undefined {
  const out: Record<string, PlanetPhys> = {};
  try {
    for (const name of PLANET_BODIES) {
      const body = Astronomy.Body[name];
      const gv = Astronomy.GeoVector(body, time, true);
      const ill = Astronomy.Illumination(body, time);
      let pole: V3 | null = null;
      try { const ax = Astronomy.RotationAxis(body, time); pole = [ax.north.x, ax.north.y, ax.north.z]; } catch { pole = null; }
      let moons: PlanetPhys['moons'] = null;
      if (name === 'Jupiter') {
        try { const jm = Astronomy.JupiterMoons(time); moons = (['io', 'europa', 'ganymede', 'callisto'] as const).map((k) => ({ key: k, rel: [jm[k].x, jm[k].y, jm[k].z] as V3 })); } catch { moons = null; }
      }
      out[name] = { distAu: gv.Length(), phaseFraction: ill.phase_fraction, geoEqj: [gv.x, gv.y, gv.z], poleEqj: pole, moons };
    }
  } catch { return undefined; }
  return out;
}

function computeStates(date: Date, obs: ObserverLocation): EyeStates {
  const time = Astronomy.MakeTime(date);
  return {
    sun: getSunState(time, obs),
    moon: getMoonState(time, obs),
    planets: getAllPlanetStates(time, obs),
    gmstDeg: getGMSTDeg(time),
    obliquityDeg: getMeanObliquityDeg(time),
    physical: computePhysical(time),
  };
}

function fmtHour(h: number): string {
  const total = Math.round((((h % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function ObserverView({ onFrame }: { onFrame?: (o: RenderOutput) => void }) {
  const { t, lang } = useI18n();
  const showDial = useEyeStore((s) => s.sundial);
  const immersive = useEyeStore((s) => s.immersive);
  const [chrome, setChrome] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera>({ ...DEFAULT_CAMERA, projection: useEyeStore.getState().projection });
  const sizeRef = useRef({ w: 1, h: 1 });
  const lastInteractRef = useRef(0);
  const tweenRef = useRef<Tween | null>(null);
  const targetsRef = useRef<EyeTarget[]>([]);
  const outRef = useRef<SundialReadout | null>(null);
  const statesRef = useRef<EyeStates | null>(null);
  const frameRef = useRef<ReturnType<typeof makeSkyFrame> | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const langRef = useRef({ lang, t });
  langRef.current = { lang, t };

  const [hud, setHud] = useState<Hud>({ az: DEFAULT_CAMERA.azDeg, alt: DEFAULT_CAMERA.altDeg, fov: DEFAULT_CAMERA.fovDeg, mag: 0.5, sundial: null });
  const [card, setCard] = useState<Card | null>(null);

  const requestClose = () => {
    if (history.state && (history.state as { eye?: boolean }).eye) history.back();
    else useEyeStore.getState().setOpen(false);
  };

  /* ---------- التاريخ: pushState وزر رجوع المتصفح ---------- */
  useEffect(() => {
    if (!(history.state && (history.state as { eye?: boolean }).eye)) history.pushState({ eye: true }, '');
    const onPop = () => useEyeStore.getState().setOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* ---------- ملء الشاشة: يخفي كل النوافذ (والشاشة الكاملة للمتصفح إن أمكن) ---------- */
  useEffect(() => {
    document.body.classList.toggle('eye-immersive', immersive);
    if (immersive && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    if (!immersive && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setChrome(true);
    if (!immersive) return () => document.body.classList.remove('eye-immersive');
    let timer = window.setTimeout(() => setChrome(false), 2500);
    const wake = () => { setChrome(true); window.clearTimeout(timer); timer = window.setTimeout(() => setChrome(false), 2500); };
    window.addEventListener('pointermove', wake);
    return () => { window.removeEventListener('pointermove', wake); window.clearTimeout(timer); document.body.classList.remove('eye-immersive'); };
  }, [immersive]);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement && useEyeStore.getState().immersive) useEyeStore.getState().setImmersive(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      useEyeStore.getState().setImmersive(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  /* ---------- الحلقة والتفاعل ---------- */
  useEffect(() => {
    document.body.classList.add('eye-view-open');
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => document.body.classList.remove('eye-view-open');

    let raf = 0;
    let lastKey = '';
    let lastDateMs = 0;
    let lastDateChange = 0;
    let statesKey = '';
    let hudStamp = 0;
    let lookN = useEyeStore.getState().lookCmd?.n ?? 0;
    let fovN = useEyeStore.getState().fovCmd?.n ?? 0;
    let magN = useEyeStore.getState().magCmd?.n ?? 0;
    const helpers = { drawMoon, drawPlanetDot };

    const touch = () => { lastInteractRef.current = performance.now(); tweenRef.current = null; };
    // موضع الجرم المتتبَّع (سمت/ارتفاع) من حالات الإطار نفسها
    const zodiacCentre = new Map<string, { ra: number; dec: number }>();
    const resolveTrack = (tt: TrackTarget): { az: number; alt: number } | null => {
      const s2 = statesRef.current, fr = frameRef.current;
      if (!s2) return null;
      if (tt.kind === 'sun') return { az: s2.sun.horizontal.azimuthDeg, alt: s2.sun.horizontal.altitudeDeg };
      if (tt.kind === 'moon') return { az: s2.moon.horizontal.azimuthDeg, alt: s2.moon.horizontal.altitudeDeg };
      if (tt.kind === 'planet') { const pl = s2.planets.find((q) => q.name === tt.name); return pl ? { az: pl.state.horizontal.azimuthDeg, alt: pl.state.horizontal.altitudeDeg } : null; }
      if (!fr) return null;
      if (tt.kind === 'star') {
        const id = useSimulationStore.getState().highlightedStarId;
        const star = id === null ? undefined : getStarByIdMap().get(id);
        if (!star) return null;
        const hh = placeRaDecJ2000(fr, star.ra, star.dec); return { az: hh.azDeg, alt: hh.altDeg };
      }
      let c = zodiacCentre.get(tt.key);
      if (!c) {
        const z = getLoadedZodiac()[tt.key];
        if (!z) return null;
        let x = 0, y = 0, zz = 0;
        for (const seg of z.segments) for (const q of seg) { if (!q) continue; const ra = q[0] * 15 * (Math.PI / 180), de = q[1] * (Math.PI / 180); x += Math.cos(de) * Math.cos(ra); y += Math.cos(de) * Math.sin(ra); zz += Math.sin(de); }
        const l = Math.hypot(x, y, zz); if (!l) return null;
        c = { ra: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 / 15, dec: (Math.asin(zz / l) * 180) / Math.PI };
        zodiacCentre.set(tt.key, c);
      }
      const hh = placeRaDecJ2000(fr, c.ra, c.dec); return { az: hh.azDeg, alt: hh.altDeg };
    };
    // حركة سلسة بزمن الإطار (مثل ستيلاريوم): سرعات تتسارع وتتباطأ، تكبير يلحق هدفه تحت المؤشر، قصور ذاتي بعد السحب
    const keys = new Set<string>();
    let velAz = 0, velAlt = 0, inertiaTau = 0.1, dragging = false, lastNow = performance.now();
    let zoomTarget: { fov: number; x: number; y: number } | null = null;
    const samples: { t: number; az: number; alt: number }[] = [];

    const startLook = (kind: LookKind | 'home') => {
      const c = camRef.current, s = statesRef.current;
      let az = c.azDeg, alt = c.altDeg, fov = c.fovDeg;
      if (kind === 'home') { az = DEFAULT_CAMERA.azDeg; alt = DEFAULT_CAMERA.altDeg; fov = DEFAULT_CAMERA.fovDeg; }
      if (kind === 'sun' || kind === 'moon') {
        if (!s) return;
        const hz = (kind === 'sun' ? s.sun : s.moon).horizontal;
        az = hz.azimuthDeg; alt = hz.altitudeDeg;
      } else if (kind === 'home') { /* الاتجاه والمجال أعلاه */ }
      else if (kind === 'north') { az = 0; alt = 8; }
      else if (kind === 'east') { az = 90; alt = 8; }
      else if (kind === 'south') { az = 180; alt = 8; }
      else if (kind === 'west') { az = 270; alt = 8; }
      else if (kind === 'zenith') { alt = 90; }
      else { az = 180; alt = -Math.atan(EYE_HEIGHT_M / DIAL_DISTANCE_M) * (180 / Math.PI); }
      lastInteractRef.current = performance.now();
      zoomTarget = null; velAz = 0; velAlt = 0;
      tweenRef.current = { az0: c.azDeg, alt0: c.altDeg, fov0: c.fovDeg, az1: az, alt1: alt, fov1: fov, t0: performance.now() };
    };

    // الانتقال إلى مكان وحقل رؤية محددين بسلاسة (اختيار من القوائم أو البحث)
    const gotoView = (az: number, alt: number, fov: number) => {
      const c = camRef.current, [fLo, fHi] = fovLimits(c.projection);
      lastInteractRef.current = performance.now(); zoomTarget = null; velAz = 0; velAlt = 0;
      tweenRef.current = { az0: c.azDeg, alt0: c.altDeg, fov0: c.fovDeg, az1: az, alt1: Math.max(-5, alt), fov1: Math.min(fHi, Math.max(fLo, fov)), t0: performance.now() };
    };
    const unit3 = (altDeg: number, azDeg: number): V3 => dirFromAltAz(altDeg, azDeg);
    const angleBetween = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * (180 / Math.PI);
    const zodiacInfo = (key: string) => {
      const fr = frameRef.current, z = getLoadedZodiac()[key];
      if (!fr || !z) return null;
      const pts: V3[] = []; let mx = 0, my = 0, mz = 0;
      for (const seg of z.segments) for (const q of seg) { if (!q) continue; const hh = placeRaDecJ2000(fr, q[0], q[1]); const d = unit3(hh.altDeg, hh.azDeg); pts.push(d); mx += d[0]; my += d[1]; mz += d[2]; }
      const l = Math.hypot(mx, my, mz); if (!l || !pts.length) return null;
      const c: V3 = [mx / l, my / l, mz / l];
      let rad = 0; for (const d of pts) rad = Math.max(rad, angleBetween(c, d));
      return { az: ((Math.atan2(c[0], c[1]) * 180) / Math.PI + 360) % 360, alt: (Math.asin(c[2]) * 180) / Math.PI, rad };
    };
    let prevSel = { z: useSimulationStore.getState().selectedZodiacs.map(String), m: [...useSimulationStore.getState().selectedMansionIndices], g: [...useSimulationStore.getState().selectedGroupIds], s: useSimulationStore.getState().highlightedStarId };
    const followSelection = (st2: ReturnType<typeof useSimulationStore.getState>) => {
      const fr = frameRef.current, so = statesRef.current;
      const cur = { z: st2.selectedZodiacs.map(String), m: [...st2.selectedMansionIndices], g: [...st2.selectedGroupIds], s: st2.highlightedStarId };
      if (fr && so) {
        const byId = getStarByIdMap();
        const tgt = selectionTarget(prevSel, cur, {
          starById: (id) => byId.get(id),
          place: (ra, dec) => { const hh = placeRaDecJ2000(fr, ra, dec); return { az: hh.azDeg, alt: hh.altDeg }; },
          groupCenter: computeGroupCenter,
          groupMembers: getGroupMemberHips,
          zodiac: zodiacInfo,
          mansionMid: (idx) => { const mans = getAllLunarMansions()[idx]; return mans ? eclipticLongitudeToEquatorial(mans.startLongitudeDeg + 6.65, so.obliquityDeg) : null; },
        });
        if (tgt) { useEyeStore.getState().setTrack(null); gotoView(tgt.az, tgt.alt, tgt.fov); }
      }
      prevSel = cur;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const rect = canvas.getBoundingClientRect();
      const W = Math.max(1, Math.round(rect.width)), H = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        lastKey = '';
      }
      sizeRef.current = { w: W, h: H };

      // أوامر اللوحة: الإسقاط، مجال الرؤية، «انظر إلى»
      const es = useEyeStore.getState();
      if (es.projection !== camRef.current.projection) camRef.current = clampCamera({ ...camRef.current, projection: es.projection });
      if (es.fovCmd && es.fovCmd.n !== fovN) { fovN = es.fovCmd.n; touch(); camRef.current = clampCamera({ ...camRef.current, fovDeg: es.fovCmd.value }); }
      if (es.magCmd && es.magCmd.n !== magN) { magN = es.magCmd.n; touch(); zoomTarget = { fov: fovForMagnification(camRef.current.projection, sizeRef.current.h, es.magCmd.value), x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 }; }
      if (es.lookCmd && es.lookCmd.n !== lookN) { lookN = es.lookCmd.n; startLook(es.lookCmd.kind); }

      // حركة الكاميرا بزمن الإطار
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      {
        let c = camRef.current;
        const { w: cw, h: ch } = sizeRef.current;
        const [fLo, fHi] = fovLimits(c.projection);
        const kx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
        const ky = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
        const keyActive = kx !== 0 || ky !== 0;
        if (keyActive) { tweenRef.current = null; inertiaTau = 0.1; }
        const trk = es.track;
        if (trk && (keyActive || dragging)) es.setTrack(null); // أي التفات يدوي يوقف التتبع
        const tg = trk && !keyActive && !dragging ? resolveTrack(trk) : null;
        if (tg) {
          const kT = 1 - Math.exp(-dt / 0.1);
          let dA = tg.az - c.azDeg; if (dA > 180) dA -= 360; if (dA < -180) dA += 360;
          c = clampCamera({ ...c, azDeg: c.azDeg + dA * kT, altDeg: c.altDeg + (Math.max(tg.alt, -2.5) - c.altDeg) * kT }); // الجرم الغارب لا ينزل تحت الأرض: تدور الكاميرا مع مستوى الأفق (أو أدنى بقليل)
          velAz = 0; velAlt = 0; tweenRef.current = null; lastInteractRef.current = now;
        } else if (!dragging) {
          const sp = Math.min(70, Math.max(4, c.fovDeg * 0.5)); // درجة/ث تتناسب مع المجال
          const k = 1 - Math.exp(-dt / (keyActive ? 0.1 : inertiaTau));
          velAz += (kx * sp - velAz) * k; velAlt += (ky * sp - velAlt) * k;
          if (!keyActive && Math.abs(velAz) < 0.05 && Math.abs(velAlt) < 0.05) { velAz = 0; velAlt = 0; }
          if (velAz !== 0 || velAlt !== 0) { c = clampCamera({ ...c, azDeg: c.azDeg + velAz * dt, altDeg: c.altDeg + velAlt * dt }); lastInteractRef.current = now; }
        }
        const zin = ZOOM_IN_CODES.some((k2) => keys.has(k2)), zout = ZOOM_OUT_CODES.some((k2) => keys.has(k2));
        if (zin !== zout) { c = zoomCameraAt(c, Math.exp((zin ? 1.3 : -1.3) * dt), cw / 2, ch / 2, cw, ch); zoomTarget = null; tweenRef.current = null; lastInteractRef.current = now; }
        if (zoomTarget) {
          const lf = Math.log(c.fovDeg), lt = Math.log(Math.min(fHi, Math.max(fLo, zoomTarget.fov)));
          const nl = lf + (lt - lf) * (1 - Math.exp(-dt / 0.09));
          c = zoomCameraAt(c, c.fovDeg / Math.exp(nl), zoomTarget.x, zoomTarget.y, cw, ch);
          if (Math.abs(lt - nl) < 0.003) zoomTarget = null;
          lastInteractRef.current = now;
        }
        // انتقال ناعم إلى اتجاه/مجال مطلوب («انظر إلى»، Home)
        const tw = tweenRef.current;
        if (tw) {
          const kk = Math.min(1, (now - tw.t0) / 750), e = kk * kk * (3 - 2 * kk);
          let dAz = tw.az1 - tw.az0; if (dAz > 180) dAz -= 360; if (dAz < -180) dAz += 360;
          c = clampCamera({ ...c, azDeg: tw.az0 + dAz * e, altDeg: tw.alt0 + (tw.alt1 - tw.alt0) * e, fovDeg: Math.exp(Math.log(tw.fov0) + (Math.log(tw.fov1) - Math.log(tw.fov0)) * e) });
          lastInteractRef.current = now;
          if (kk >= 1) tweenRef.current = null;
        }
        camRef.current = c;
      }

      const st = useSimulationStore.getState();
      const dateMs = st.date.getTime();
      if (dateMs !== lastDateMs) { lastDateMs = dateMs; lastDateChange = now; }
      const obs = st.observer;
      const sKey = `${dateMs}|${obs.latitudeDeg}|${obs.longitudeDeg}|${obs.elevationM}`;
      if (sKey !== statesKey || !statesRef.current) {
        statesRef.current = computeStates(st.date, obs); statesKey = sKey;
        frameRef.current = makeSkyFrame(Astronomy.MakeTime(st.date), obs);
        const s = statesRef.current;
        // بطاقة «بيانات السماء» تقرأ هذه القيم نفسها (مصدر واحد)
        onFrameRef.current?.({ sun: s.sun, moon: s.moon, planets: s.planets, gmstDeg: s.gmstDeg, hitTargets: [] });
      }
      const states = statesRef.current;
      followSelection(st);

      const cam = camRef.current;
      const L = st.layers;
      const { lang: lg, t: tt } = langRef.current;
      const busy = now - lastInteractRef.current < 250 || now - lastDateChange < 300;
      const bgScale = busy ? 0.18 : 0.45;
      const key = [
        cam.azDeg.toFixed(3), cam.altDeg.toFixed(3), cam.fovDeg.toFixed(3), cam.rollDeg, cam.projection, W, H, dpr, bgScale, sKey, lg,
        L.stars, L.planets, L.labels, L.ecliptic, L.aurora, es.ground, es.sundial, es.altAzGrid, es.solarFilter, es.atmVersion, getGpuStamp(),
        st.auroraKp, st.selectedZodiacs.join(','), st.selectedMansionIndices.join(','), st.selectedGroupIds.join(','), st.highlightedStarId,
      ].join('|');

      if (key !== lastKey) {
        lastKey = key;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const input: EyeInput = {
          date: st.date, observer: obs, camera: cam, states,
          options: {
            stars: L.stars, planets: L.planets, labels: L.labels, ecliptic: L.ecliptic,
            ground: es.ground, sundial: es.sundial, altAzGrid: es.altAzGrid,
            aurora: L.aurora, auroraKp: st.auroraKp, eyeHeightM: EYE_HEIGHT_M, solarFilter: es.solarFilter,
          },
          selection: { zodiacs: st.selectedZodiacs, mansionIndices: st.selectedMansionIndices, groupIds: st.selectedGroupIds, highlightedStarId: st.highlightedStarId },
          names: {
            sun: tt('eye_sun'), moon: tt('eye_moon'),
            planet: (id) => (lg === 'ar' ? PLANET_LABELS_AR[id as PlanetName] ?? id : id),
            cardinals: CARDINAL_KEYS.map((k) => tt(k)),
            mansion: (index, nameAr) => mansionName({ index, nameAr }, lg),
            group: (g) => groupName(g, lg),
            zodiac: (key) => zodiacName(key, getZodiacNameAr(key as ZodiacKey, Math.max(0, ZODIAC_ORDER.indexOf(key as ZodiacKey))), lg),
            jovian: (k) => JUPITER_MOON_NAMES[k]?.[lg] ?? k,
            belowHorizon: tt('eye_below_horizon'),
          },
          bgScale,
        };
        const out = renderEye(ctx, W, H, input, helpers, now);
        targetsRef.current = out.targets;
        outRef.current = out.sundial;
      }

      if (now - hudStamp > 250) {
        hudStamp = now;
        es.mirrorFov(cam.fovDeg);
        setHud({ az: cam.azDeg, alt: cam.altDeg, fov: cam.fovDeg, mag: magnificationAt(makeProjector(cam, W, H)), sundial: outRef.current });
      }
    };
    raf = requestAnimationFrame(loop);

    /* ----- مؤشرات: سحب بإصبع، قرص بإصبعين، عجلة، نقر لبطاقة المعلومات ----- */
    const pointers = new Map<number, { x: number; y: number }>();
    let downX = 0, downY = 0, moved = false, pinchDist = 0;
    const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      touch(); zoomTarget = null; velAz = 0; velAlt = 0; samples.length = 0;
      if (pointers.size === 1) { downX = p.x; downY = p.y; moved = false; }
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        moved = true; dragging = false;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const { w, h } = sizeRef.current;
      touch();
      if (pointers.size === 1) {
        if (!moved && Math.hypot(p.x - downX, p.y - downY) > 4) moved = true;
        if (moved) {
          dragging = true;
          camRef.current = dragCamera(camRef.current, p.x - prev.x, p.y - prev.y, makeProjector(camRef.current, w, h).f);
          const now = performance.now();
          samples.push({ t: now, az: camRef.current.azDeg, alt: camRef.current.altDeg });
          while (samples.length > 2 && now - samples[0].t > 110) samples.shift();
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        camRef.current = zoomCameraAt(camRef.current, d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2, w, h);
        pinchDist = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1 && pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && dragging) {
        dragging = false;
        // قصور ذاتي: سرعة آخر 110 مللي ثانية من السحب
        const now = performance.now();
        if (samples.length >= 2 && now - samples[samples.length - 1].t < 80) {
          const f0 = samples[0], f1 = samples[samples.length - 1], dtS = (f1.t - f0.t) / 1000;
          if (dtS > 0.01) {
            let dAz = f1.az - f0.az; if (dAz > 180) dAz -= 360; if (dAz < -180) dAz += 360;
            velAz = dAz / dtS; velAlt = (f1.alt - f0.alt) / dtS; inertiaTau = 0.28;
            if (Math.hypot(velAz, velAlt) < 3) { velAz = 0; velAlt = 0; }
          }
        }
      }
      if (wasSingle && !moved) {
        const p = local(e);
        let best: EyeTarget | null = null, bd = 18;
        for (const tg of targetsRef.current) {
          if (!tg.name) continue; // علامة طرف الظل بلا اسم
          const d = Math.hypot(tg.x - p.x, tg.y - p.y);
          if (d < bd) { bd = d; best = tg; }
        }
        setCard(best ? { name: best.name, detail: best.detail } : null);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const [fLo, fHi] = fovLimits(camRef.current.projection);
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const base = zoomTarget ? zoomTarget.fov : camRef.current.fovDeg;
      tweenRef.current = null; lastInteractRef.current = performance.now();
      zoomTarget = { fov: Math.min(fHi, Math.max(fLo, base * Math.exp(dy * 0.0014))), x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const isTyping = (e: KeyboardEvent) => { const tg = e.target as HTMLElement | null; return !!tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName); };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e) && e.code !== 'Escape') return;
      if (e.code === 'Escape') {
        // نافذة منبثقة في اللوحة مفتوحة: اللوحة تغلقها أولاً
        if (document.querySelector('.popover-panel')) return;
        e.stopImmediatePropagation(); e.preventDefault();
        if (useEyeStore.getState().immersive) useEyeStore.getState().setImmersive(false); else requestClose();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (HOLD_CODES.includes(e.code)) {
        e.preventDefault(); e.stopImmediatePropagation(); // لا تصل الأسهم إلى الخريطة المخفية
        if (!e.repeat) touch();
        keys.add(e.code);
        return;
      }
      let used = true;
      switch (e.code) {
        case 'Home': useEyeStore.getState().setTrack(null); startLook('home'); break;
        case 'Digit0': useEyeStore.getState().setMagnification(1); break;
        case 'KeyS': if (e.shiftKey) useEyeStore.getState().setTrack({ kind: 'sun' }); else useEyeStore.getState().look('sun'); break;
        case 'KeyM': if (e.shiftKey) useEyeStore.getState().setTrack({ kind: 'moon' }); else useEyeStore.getState().look('moon'); break;
        case 'KeyX': useEyeStore.getState().setTrack(null); break;
        case 'KeyV': useEyeStore.getState().setSolarFilter(!useEyeStore.getState().solarFilter); break;
        case 'KeyZ': useEyeStore.getState().look('zenith'); break;
        case 'KeyT': useEyeStore.getState().look('dial'); break;
        case 'Digit1': useEyeStore.getState().setProjection('perspective'); break;
        case 'Digit2': useEyeStore.getState().setProjection('stereographic'); break;
        case 'Digit3': useEyeStore.getState().setProjection('equidistant'); break;
        default: used = false;
      }
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
    const onBlur = () => { keys.clear(); };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('eye-view-open');
    };
  }, []);

  const sd = hud.sundial;
  return (
    <div className="eye-root" role="region" aria-label={t('nav_eye')} data-immersive={immersive} data-chrome={chrome}>
      <canvas ref={canvasRef} className="eye-canvas" />

      <div className="eye-top">
        <div className="eye-title">
          <strong>{t('nav_eye')}</strong>
          <span className="eye-mono">{t('eye_hud', { az: hud.az.toFixed(1), alt: hud.alt.toFixed(1), fov: hud.fov.toFixed(hud.fov < 10 ? 2 : 1), mag: hud.mag < 10 ? hud.mag.toFixed(2) : hud.mag.toFixed(0) })}</span>
        </div>
        <div className="eye-top-actions">
          <button className="eye-btn eye-btn-icon" onClick={() => useEyeStore.getState().setImmersive(!immersive)} aria-label={t(immersive ? 'eye_immersive_exit' : 'eye_immersive')} title={t(immersive ? 'eye_immersive_exit' : 'eye_immersive')}>
            {immersive ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <button className="eye-btn eye-btn-icon" onClick={requestClose} aria-label={t('eye_close')} title={t('eye_close')}><X size={18} /></button>
        </div>
      </div>

      {showDial && sd && (
        <div className="eye-dial">
          <strong>{t('eye_sd_title')}</strong>
          <dl>
            <dt>{t('eye_sd_len')}</dt>
            <dd className="eye-mono">{sd.lengthRatio === null || sd.lengthM === null ? t('eye_sd_none') : t('eye_sd_len_val', { ratio: sd.lengthRatio.toFixed(2), m: sd.lengthM.toFixed(2) })}</dd>
            <dt>{t('eye_sd_dir')}</dt>
            <dd className="eye-mono">{sd.shadowAzDeg === null ? '—' : `${sd.shadowAzDeg.toFixed(1)}°`}</dd>
            <dt>{t('eye_sd_hour')}</dt>
            <dd className="eye-mono">{fmtHour(sd.solarHour)}</dd>
            <dt>{t('eye_sd_src')}</dt>
            <dd>{sd.source === 'sun' ? t('eye_sd_src_sun') : sd.source === 'moon' ? t('eye_sd_src_moon') : '—'}</dd>
          </dl>
        </div>
      )}

      {card && (
        <div className="eye-card" role="status">
          <button className="eye-btn eye-btn-icon" onClick={() => setCard(null)} aria-label={t('eye_close')}><X size={14} /></button>
          <strong>{card.name}</strong>
          <span className="eye-label">{t('eye_card_hint')}</span>
          <span className="eye-mono">{card.detail}</span>
        </div>
      )}
    </div>
  );
}
