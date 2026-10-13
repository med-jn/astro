import { useEffect, useMemo, useRef, useState } from 'react';
import { Moon, X, Play, MapPin, Crosshair } from 'lucide-react';
import { useSimulationStore } from '../state/store';
import {
  findEclipsesBetween, eclipseTitleAr, localSolarCircumstances, localLunarCircumstances,
  solarViewAt, lunarViewAt, lunarEclipseTags,
  type EclipseEvent, type SolarEclipseEvent, type LunarEclipseEvent,
  type LocalSolarCircumstances, type LocalLunarCircumstances,
} from '../core/eclipses';
import { drawSolarView, drawLunarView, drawHorizonStrip, setMoonTexture, DANJON_LABELS_AR } from '../render/eclipseView';
import { getMoonImage, onBodyImageReady } from '../render/bodyImages';

const LUNAR_PHASE_AR: Record<string, string> = {
  P1: 'بداية الخسوف الهامشي (P1)', U1: 'بداية الخسوف الجزئي (U1)', U2: 'بداية الخسوف الكلي (U2)', MAX: 'أعظم خسوف',
  U3: 'نهاية الخسوف الكلي (U3)', U4: 'نهاية الخسوف الجزئي (U4)', P4: 'نهاية الخسوف الهامشي (P4)',
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtUT(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}
function fmtTime(d: Date, withSeconds = false): string {
  return d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });
}

/** يوقف الزمن ويقفز إلى لحظة معيّنة */
function jumpTo(date: Date) {
  useSimulationStore.setState({ date, isPlaying: false, customTimeRateDegPerSec: null });
}

/** يشغّل المحاكاة بسرعة دقيقة لكل ثانية انطلاقاً من لحظة معيّنة */
function playFrom(date: Date) {
  useSimulationStore.setState({ date, isPlaying: true, speedIndex: 1, customTimeRateDegPerSec: null });
}

interface Row {
  event: EclipseEvent;
  solar?: LocalSolarCircumstances | null;
  lunar?: LocalLunarCircumstances;
}

// ============================= المنظر المحلي الحي =============================

function LiveView({ event }: { event: EclipseEvent }) {
  const date = useSimulationStore((s) => s.date);
  const observer = useSimulationStore((s) => s.observer);
  const ref = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const W = 300, H = 240, SH = 84;
  const [note, setNote] = useState('');
  const [danjon, setDanjon] = useState(2);
  const [imgTick, setImgTick] = useState(0);

  // صورة القمر: تُطلب عند فتح المنظر وتُعاد الرسم عند اكتمال التحميل
  useEffect(() => {
    const apply = () => { const im = getMoonImage(); if (im) { setMoonTexture(im); setImgTick((t) => t + 1); } };
    apply();
    return onBodyImageReady(apply);
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const obs = { latitudeDeg: observer.latitudeDeg, longitudeDeg: observer.longitudeDeg, elevationM: (observer as { elevationM?: number }).elevationM };

    if (event.type === 'solar') {
      const v = solarViewAt(date, obs);
      if (v.sun.altDeg < -0.9) {
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H);
        setNote('الشمس تحت الأفق في موقعك الآن');
      } else {
        drawSolarView(ctx, W, H, v);
        const kind = v.phase === 'total' ? 'كلي' : v.phase === 'annular' ? 'حلقي' : v.phase === 'partial' ? 'جزئي' : 'لا كسوف في هذه اللحظة';
        setNote(`${kind} · تغطية ${(v.obscuration * 100).toFixed(1)}% · القدر ${Math.max(0, v.magnitude).toFixed(3)} · ارتفاع الشمس ${v.sun.altDeg.toFixed(1)}°`);
      }
    } else {
      const v = lunarViewAt(date, obs);
      if (v.moon.altDeg < -0.9) {
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H);
        setNote(`القمر تحت الأفق في موقعك الآن (ارتفاعه ${v.moon.altDeg.toFixed(1)}°) — اختر لحظة يكون فيها فوق الأفق`);
      } else {
        drawLunarView(ctx, W, H, v, { danjonL: danjon });
        const both = v.sun.altDeg > -0.9 && v.umbralMagnitude > 0;
        setNote(
          `قدر الخسف ${Math.max(0, v.umbralMagnitude).toFixed(3)} · القدر الهامشي ${Math.max(0, v.penumbralMagnitude).toFixed(3)} · ` +
          `ارتفاع القمر ${v.moon.altDeg.toFixed(1)}°` + (both ? ' · الشمس والقمر فوق الأفق معاً (خسوف أفقي)' : '')
        );
      }
      const sc = stripRef.current;
      if (sc) {
        sc.width = W * dpr; sc.height = SH * dpr;
        const c2 = sc.getContext('2d')!;
        c2.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawHorizonStrip(c2, W, SH, { sun: v.sun, moon: v.moon, shadow: v.shadow, umbralMagnitude: v.umbralMagnitude });
      }
    }
  }, [date, observer.latitudeDeg, observer.longitudeDeg, event, danjon, imgTick]);

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
      <canvas ref={ref} style={{ width: W, height: H, borderRadius: 8, border: '1px solid rgba(226,232,240,0.15)' }} />
      {event.type === 'lunar' && (
        <canvas ref={stripRef} style={{ width: W, height: SH, borderRadius: 8, border: '1px solid rgba(226,232,240,0.15)' }} />
      )}
      {event.type === 'lunar' && (
        <label style={{ fontSize: '0.78em', display: 'flex', gap: 6, alignItems: 'center' }}>
          لون الخسوف (مقياس دانجون)
          <select value={danjon} onChange={(e) => setDanjon(Number(e.target.value))}>
            {DANJON_LABELS_AR.map((t, i) => <option key={i} value={i}>{t}</option>)}
          </select>
        </label>
      )}
      <div style={{ fontSize: '0.78em', opacity: 0.85, textAlign: 'center', maxWidth: W }}>{note}</div>
    </div>
  );
}

// ============================= اللوحة =============================

type Tab = 'solar' | 'lunar';

const css = {
  seg: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 3, borderRadius: 10, background: 'rgba(148,163,184,0.12)' } as const,
  segBtn: (on: boolean) => ({
    padding: '7px 6px', borderRadius: 8, border: 0, cursor: 'pointer', fontSize: '0.9em', fontFamily: 'inherit',
    color: on ? '#fff' : 'inherit', background: on ? 'rgba(212,160,70,0.55)' : 'transparent',
  }) as const,
  card: { padding: '8px 10px', borderRadius: 10, background: 'rgba(148,163,184,0.09)', display: 'grid', gap: 5 } as const,
  h: { fontSize: '0.74em', letterSpacing: 0, opacity: 0.65, margin: '2px 0 0' } as const,
  kv: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.84em' } as const,
};

function KV({ k, v }: { k: string; v: string }) {
  return <div style={css.kv}><span style={{ opacity: 0.7 }}>{k}</span><span style={{ textAlign: 'left', direction: 'ltr', unicodeBidi: 'plaintext' }}>{v}</span></div>;
}

function visInfo(vis: string | undefined): { txt: string; color: string } {
  if (vis === 'full') return { txt: 'يُرى كاملاً', color: '#6fcf97' };
  if (vis === 'partial') return { txt: 'يُرى جزئياً', color: '#e5b94d' };
  return { txt: 'لا يُرى من موقعك', color: '#7b8798' };
}

export function EclipsePanel() {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('solar');
  const [sel, setSel] = useState<number | null>(null); // peakMs للحدث المفتوح

  const date = useSimulationStore((s) => s.date);
  const observer = useSimulationStore((s) => s.observer);
  const focus = useSimulationStore((s) => s.eclipseFocus);
  const y = year ?? date.getFullYear();

  // الحساب الثقيل لا يجري إلا والنافذة مفتوحة، ويُخزَّن لكل سنة وموقع لا لكل إطار
  const rows: Row[] = useMemo(() => {
    if (!open) return [];
    const evs = findEclipsesBetween(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)));
    const obs = { latitudeDeg: observer.latitudeDeg, longitudeDeg: observer.longitudeDeg, elevationM: (observer as { elevationM?: number }).elevationM };
    return evs.map((event) => {
      try {
        if (event.type === 'solar') return { event, solar: localSolarCircumstances(event.peak, obs) };
        return { event, lunar: localLunarCircumstances(event, obs) };
      } catch {
        return { event };
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, y, observer.latitudeDeg, observer.longitudeDeg]);

  const nSolar = rows.filter((r) => r.event.type === 'solar').length;
  const nLunar = rows.length - nSolar;
  const list = rows.filter((r) => r.event.type === tab);
  const current = sel != null ? rows.find((r) => r.event.peak.getTime() === sel) ?? null : null;

  const choose = (r: Row) => {
    const e = r.event;
    useSimulationStore.getState().setEclipseFocus({ type: e.type, peakMs: e.peak.getTime() });
    jumpTo(e.peak);
    setSel(e.peak.getTime());
  };

  return (
    <div className="icon-item">
      <button className="icon-trigger" data-active={open || !!focus} onClick={() => setOpen((v) => !v)} title="الكسوف والخسوف">
        <Moon size={19} />
        <span className="icon-caption">كسوف</span>
        {focus && <span className="badge-dot" />}
      </button>
      {open && (
        <div className="popover-panel" role="dialog" aria-label="الكسوف والخسوف" style={{ maxHeight: '85vh', overflowY: 'auto', width: 360 }}>
          <div className="popover-header">
            <Moon size={16} />
            <span className="popover-title-text">الكسوف والخسوف</span>
            <button className="popover-close" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <div className="popover-body" style={{ display: 'grid', gap: 10 }}>
            {!current ? (
              <>
                <div className="stepper-row">
                  <span className="stepper-label">السنة</span>
                  <div className="stepper-controls">
                    <button className="stepper-btn" onClick={() => setYear(y - 1)}>−</button>
                    <span className="stepper-value">{y}</span>
                    <button className="stepper-btn" onClick={() => setYear(y + 1)}>+</button>
                  </div>
                </div>

                <div style={css.seg} role="tablist">
                  <button role="tab" aria-selected={tab === 'solar'} style={css.segBtn(tab === 'solar')} onClick={() => setTab('solar')}>كسوف الشمس ({nSolar})</button>
                  <button role="tab" aria-selected={tab === 'lunar'} style={css.segBtn(tab === 'lunar')} onClick={() => setTab('lunar')}>خسوف القمر ({nLunar})</button>
                </div>

                {focus && (
                  <button className="clear-btn" onClick={() => useSimulationStore.getState().setEclipseFocus(null)}>
                    إخفاء مسار الحدث من الخريطة
                  </button>
                )}

                <div style={{ display: 'grid', gap: 6 }}>
                  {list.length === 0 && <div style={{ opacity: 0.7, padding: 8 }}>لا {tab === 'solar' ? 'كسوف' : 'خسوف'} في هذه السنة.</div>}
                  {list.map((r) => {
                    const e = r.event;
                    const solar = e.type === 'solar';
                    const v = visInfo(solar ? r.solar?.visibility : r.lunar?.visibility);
                    const horizontal = !solar && !!r.lunar?.horizontal;
                    const tags = solar ? [] : lunarEclipseTags(e as LunarEclipseEvent);
                    return (
                      <button key={e.peak.getTime()} className="select-item" aria-pressed={focus?.peakMs === e.peak.getTime()} onClick={() => choose(r)}
                        style={{ display: 'grid', gap: 3, textAlign: 'right', opacity: v.color === '#7b8798' ? 0.8 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <strong style={{ fontWeight: 600 }}>{eclipseTitleAr(e)}</strong>
                          <span style={{ fontSize: '0.78em', color: v.color }}>● {v.txt}</span>
                        </div>
                        <div style={{ fontSize: '0.8em', opacity: 0.75 }}>
                          {fmtDate(e.peak)} · {fmtTime(e.peak)}
                        </div>
                        {(tags.length > 0 || horizontal) && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {tags.map((t) => <span key={t} style={{ fontSize: '0.7em', padding: '1px 7px', borderRadius: 8, background: 'rgba(148,163,184,0.22)' }}>{t}</span>)}
                            {horizontal && <span style={{ fontSize: '0.7em', padding: '1px 7px', borderRadius: 8, background: 'rgba(212,160,70,0.3)' }}>خسوف مقلوب (أفقي)</span>}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <Detail row={current} onBack={() => setSel(null)} />
            )}
            <div style={{ fontSize: '0.72em', opacity: 0.55, padding: '2px 4px' }}>
              الأزمنة بتوقيت جهازك (والتوقيت العالمي بجانبها). المحاكاة بمكتبة astronomy-engine؛ وقد يختلف التقدير عن جداول ناسا بأجزاء من المئة في القدر وبثوانٍ في الأزمنة.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ row, onBack }: { row: Row; onBack: () => void }) {
  const e = row.event;
  const solar = e.type === 'solar';
  const focus = useSimulationStore((s) => s.eclipseFocus);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button className="clear-btn" onClick={onBack} style={{ width: 'auto', padding: '4px 10px' }}>‹ القائمة</button>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{eclipseTitleAr(e)}</div>
          <div style={{ fontSize: '0.78em', opacity: 0.75 }}>{fmtDate(e.peak)}</div>
        </div>
      </div>
      {solar
        ? <SolarDetails e={e as SolarEclipseEvent} loc={row.solar ?? null} />
        : <LunarDetails e={e as LunarEclipseEvent} loc={row.lunar} />}
      {focus && (
        <button className="clear-btn" onClick={() => useSimulationStore.getState().setEclipseFocus(null)}>إخفاء مسار الحدث من الخريطة</button>
      )}
    </div>
  );
}

function ContactBtn({ label, time, extra }: { label: string; time: Date; extra?: string }) {
  return (
    <button className="select-item" onClick={() => jumpTo(time)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.84em' }}>
      <span>{label}</span>
      <span style={{ direction: 'ltr', opacity: 0.85 }}>{fmtTime(time, true)}{extra ? ` · ${extra}` : ''}</span>
    </button>
  );
}

function SolarDetails({ e, loc }: { e: SolarEclipseEvent; loc: LocalSolarCircumstances | null }) {
  const setObserver = useSimulationStore((s) => s.setObserver);
  const contacts: [string, { time: Date; altitudeDeg: number } | undefined][] = loc ? [
    ['بداية الكسوف الجزئي (C1)', loc.c1],
    ['بداية الكلي/الحلقي (C2)', loc.c2],
    ['أعظم كسوف', loc.max],
    ['نهاية الكلي/الحلقي (C3)', loc.c3],
    ['نهاية الكسوف الجزئي (C4)', loc.c4],
  ] : [];
  return (
    <>
      <div style={css.card}>
        <div style={css.h}>الحدث عالمياً</div>
        <KV k="أعظم كسوف" v={`${fmtUT(e.peak)} UT`} />
        <KV k="القدر" v={Number.isFinite(e.magnitude) ? e.magnitude.toFixed(4) : '—'} />
        <KV k="γ" v={e.gamma.toFixed(4)} />
        {e.greatestDurationSec ? <KV k="أطول مدة" v={`${Math.floor(e.greatestDurationSec / 60)}د ${Math.round(e.greatestDurationSec % 60)}ث`} /> : null}
        <KV k="نقطة أعظم كسوف" v={`${e.greatest.latDeg.toFixed(2)}°، ${e.greatest.lonDeg.toFixed(2)}°`} />
        {!e.central && e.kind !== 'partial' ? <KV k="ملاحظة" v="كسوف غير مركزي" /> : null}
      </div>

      <div style={css.card}>
        <div style={css.h}>من موقعك</div>
        {loc ? (
          <>
            <KV k="النوع" v={loc.kind === 'total' ? 'كلي' : loc.kind === 'annular' ? 'حلقي' : 'جزئي'} />
            <KV k="القدر" v={loc.magnitude.toFixed(3)} />
            <KV k="نسبة التغطية" v={`${(loc.obscuration * 100).toFixed(1)}%`} />
            {loc.centralDurationSec ? <KV k="مدة المركزي" v={`${Math.floor(loc.centralDurationSec / 60)}د ${Math.round(loc.centralDurationSec % 60)}ث`} /> : null}
            <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
              {contacts.map(([label, p]) => p ? (
                <ContactBtn key={label} label={label} time={p.time} extra={`${p.altitudeDeg.toFixed(0)}°`} />
              ) : null)}
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.75, fontSize: '0.84em' }}>
            لا يُرى هذا الكسوف من موقعك. على الخريطة: النطاق الواسع منطقة الكسوف الجزئي، والشريط الضيّق مسار الكلي أو الحلقي.
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        {loc && (
          <button className="select-item" onClick={() => playFrom(new Date(loc.c1.time.getTime() - 5 * 60000))}>
            <Play size={13} /> تشغيل الكسوف من موقعك
          </button>
        )}
        <button className="select-item" onClick={() => setObserver({ latitudeDeg: e.greatest.latDeg, longitudeDeg: e.greatest.lonDeg })}>
          <Crosshair size={13} /> انقل موقعي إلى نقطة أعظم كسوف
        </button>
      </div>

      <LiveView event={e} />
    </>
  );
}

function LunarDetails({ e, loc }: { e: LunarEclipseEvent; loc?: LocalLunarCircumstances }) {
  return (
    <>
      <div style={css.card}>
        <div style={css.h}>الحدث عالمياً</div>
        <KV k="أعظم خسوف" v={`${fmtUT(e.peak)} UT`} />
        <KV k="قدر الخسف" v={e.umbralMagnitude.toFixed(4)} />
        <KV k="القدر الهامشي" v={e.penumbralMagnitude.toFixed(4)} />
        <KV k="γ" v={e.gamma.toFixed(4)} />
      </div>

      <div style={css.card}>
        <div style={css.h}>اللحظات من موقعك (اضغط للانتقال)</div>
        {loc?.contacts.length ? (
          <div style={{ display: 'grid', gap: 4 }}>
            {loc.contacts.map((c) => (
              <ContactBtn key={c.key} label={LUNAR_PHASE_AR[c.key]} time={c.time}
                extra={c.moonUp ? `القمر ${c.moonAltDeg.toFixed(0)}°` : 'تحت الأفق'} />
            ))}
          </div>
        ) : <div style={{ opacity: 0.75, fontSize: '0.84em' }}>لا لحظات محسوبة لموقعك.</div>}
        {loc?.horizontal && (
          <button className="select-item" style={{ fontSize: '0.84em' }}
            onClick={() => jumpTo(new Date((loc.horizontal!.start.getTime() + loc.horizontal!.end.getTime()) / 2))}>
            <MapPin size={13} /> الخسوف المقلوب: {fmtTime(loc.horizontal.start, true)} – {fmtTime(loc.horizontal.end, true)}
            {' '}· أقصى قدر خسف {loc.horizontal.maxUmbralMagnitude.toFixed(2)}
          </button>
        )}
      </div>

      <button className="select-item" onClick={() => playFrom(new Date(e.peak.getTime() - 3.5 * 3600 * 1000))}>
        <Play size={13} /> تشغيل الخسوف
      </button>

      <LiveView event={e} />
    </>
  );
}
