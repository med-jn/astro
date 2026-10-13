import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { Moon, Pause, Play, Sun } from 'lucide-react';
import { fmtClock, fmtDateLong, fmtDateTime, useI18n, type TKey } from '../i18n';
import {
  findEclipses,
  lunarViewAt,
  solarLocalMax,
  solarViewAt,
  type EclipseEvent,
} from '../core/lunar';

const MOON_TEXTURE = '/images/moon.png';
const C = 120; // مركز مساحة الرسم (240×240)

/* ------------------------------------------------------------------ */
/*  كسوف الشمس: منظر مرصدي، الشمال للأعلى والشرق لليسار                 */
/* ------------------------------------------------------------------ */
function SolarCanvas({ x, y, sunR, moonR, magnitude, sunAlt }: {
  x: number; y: number; sunR: number; moonR: number; magnitude: number; sunAlt: number;
}) {
  const uid = useId().replace(/:/g, '');
  const scale = 110; // بكسل لكل درجة (المجال ±~1.1°)
  const sr = sunR * scale;
  const mr = moonR * scale;
  const night = sunAlt <= 0;
  const total = magnitude >= 1;
  return (
    <svg viewBox="0 0 240 240" className="ecl-svg" role="img">
      <defs>
        <clipPath id={`f${uid}`}><circle cx={C} cy={C} r={112} /></clipPath>
        <radialGradient id={`sun${uid}`}>
          <stop offset="0" stopColor="#fff6d6" />
          <stop offset="0.8" stopColor="#ffd25e" />
          <stop offset="1" stopColor="#f2a53a" />
        </radialGradient>
        <radialGradient id={`cor${uid}`}>
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#f${uid})`}>
        <rect width="240" height="240" fill={night ? '#07090d' : '#16233a'} />
        <circle cx={C} cy={C} r={sr * (total ? 3 : 1.6)} fill={`url(#cor${uid})`} opacity={total ? 0.9 : 0.25} />
        <circle cx={C} cy={C} r={sr} fill={`url(#sun${uid})`} />
        <circle cx={C + x * scale} cy={C + y * scale} r={mr} fill="#06080b" stroke="rgba(255,255,255,0.12)" strokeWidth={0.6} />
        {/* حلقات مرجعية كل 0.5° */}
        <circle cx={C} cy={C} r={0.5 * scale} className="ecl-ring" />
        <circle cx={C} cy={C} r={1.0 * scale} className="ecl-ring" />
        <line x1={C} y1={8} x2={C} y2={232} className="ecl-ring" />
        <line x1={8} y1={C} x2={232} y2={C} className="ecl-ring" />
      </g>
      <circle cx={C} cy={C} r={112} fill="none" className="ecl-frame" />
      <text x={C} y={14} textAnchor="middle" className="ecl-axis">N</text>
      <text x={14} y={C + 4} textAnchor="middle" className="ecl-axis">E</text>
      <text x={226} y={C + 4} textAnchor="middle" className="ecl-axis">W</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  خسوف القمر: ظل الأرض عند مسافة القمر                               */
/* ------------------------------------------------------------------ */
function LunarCanvas({ x, y, moonR, umbraR, penumbraR }: {
  x: number; y: number; moonR: number; umbraR: number; penumbraR: number;
}) {
  const uid = useId().replace(/:/g, '');
  const scale = 68;
  const mx = x * scale;
  const my = y * scale;
  const mr = moonR * scale;
  return (
    <svg viewBox="0 0 240 240" className="ecl-svg" role="img">
      <defs>
        <clipPath id={`f${uid}`}><circle cx={C} cy={C} r={112} /></clipPath>
        <clipPath id={`m${uid}`}><circle r={mr} /></clipPath>
      </defs>
      <g clipPath={`url(#f${uid})`}>
        <rect width="240" height="240" fill="#07090d" />
        <circle cx={C} cy={C} r={penumbraR * scale} fill="rgba(150,160,180,0.16)" stroke="rgba(180,190,205,0.45)" strokeDasharray="3 3" strokeWidth={0.8} />
        <circle cx={C} cy={C} r={umbraR * scale} fill="rgba(0,0,0,0.55)" stroke="rgba(214,168,92,0.7)" strokeWidth={0.9} />
        <g transform={`translate(${C + mx} ${C + my})`}>
          <circle r={mr} fill="#8d96a3" />
          <image href={MOON_TEXTURE} x={-mr} y={-mr} width={2 * mr} height={2 * mr} preserveAspectRatio="xMidYMid slice" clipPath={`url(#m${uid})`} />
          <g clipPath={`url(#m${uid})`}>
            <circle cx={-mx} cy={-my} r={penumbraR * scale} fill="rgba(0,0,0,0.28)" />
            <circle cx={-mx} cy={-my} r={umbraR * scale} fill="rgba(140,38,18,0.72)" />
          </g>
          <circle r={mr} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={0.6} />
        </g>
      </g>
      <circle cx={C} cy={C} r={112} fill="none" className="ecl-frame" />
      <text x={C} y={14} textAnchor="middle" className="ecl-axis">N</text>
      <text x={14} y={C + 4} textAnchor="middle" className="ecl-axis">E</text>
      <text x={226} y={C + 4} textAnchor="middle" className="ecl-axis">W</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  اللوحة الكاملة                                                      */
/* ------------------------------------------------------------------ */
export function EclipseSimulator({
  date,
  latitudeDeg,
  longitudeDeg,
  onGoTo,
}: {
  date: Date;
  latitudeDeg: number;
  longitudeDeg: number;
  onGoTo: (d: Date) => void;
}) {
  const { t, locale } = useI18n();
  const dayKey = Math.floor(date.getTime() / 86_400_000);
  const events = useMemo(() => findEclipses(new Date(dayKey * 86_400_000), 6), [dayKey]);

  const [sel, setSel] = useState(0);
  const [offset, setOffset] = useState(0); // دقائق حول الذروة
  const [anim, setAnim] = useState(false);

  const ev: EclipseEvent | undefined = events[Math.min(sel, events.length - 1)];
  const solar = ev?.kind === 'solar';
  const range = solar ? 150 : 200;

  // الذروة عند موقع الراصد (للكسوف) أو الذروة العامة (للخسوف)
  const local = useMemo(
    () => (ev && solar ? solarLocalMax(ev.time, latitudeDeg, longitudeDeg) : null),
    [ev, solar, latitudeDeg, longitudeDeg],
  );
  const center = local ? local.time : ev?.time;

  useEffect(() => {
    if (!anim) return;
    const id = setInterval(() => setOffset((o) => (o + 2 > range ? -range : o + 2)), 60);
    return () => clearInterval(id);
  }, [anim, range]);

  if (!ev || !center) return <p className="muted">{t('ecl_none')}</p>;

  const when = new Date(center.getTime() + offset * 60_000);
  const sv = solar ? solarViewAt(when, latitudeDeg, longitudeDeg) : null;
  const lv = !solar ? lunarViewAt(when) : null;
  const visible = !!local && local.view.magnitude > 0 && local.view.sunAlt > 0;

  const select = (i: number) => {
    setSel(i);
    setOffset(0);
    setAnim(false);
  };

  return (
    <div className="sim">
      <div className="sim-section-title">{t('ecl_next')}</div>
      <ul className="event-list">
        {events.map((e, i) => (
          <li key={`${e.kind}${e.time.getTime()}`}>
            <button className="event-row event-select" data-selected={i === sel} onClick={() => select(i)}>
              {e.kind === 'solar' ? <Sun size={18} /> : <Moon size={18} />}
              <span className="event-main">
                <span className="event-title">
                  {t(e.kind === 'solar' ? 'ecl_solar' : 'ecl_lunar')} · {t(`ecl_${e.type}` as TKey)}
                </span>
                <span className="event-sub num">{fmtDateLong(e.time, locale.date)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="ecl-stage">
        {sv ? (
          <SolarCanvas x={sv.x} y={sv.y} sunR={sv.sunR} moonR={sv.moonR} magnitude={sv.magnitude} sunAlt={sv.sunAlt} />
        ) : (
          lv && <LunarCanvas x={lv.x} y={lv.y} moonR={lv.moonR} umbraR={lv.umbraR} penumbraR={lv.penumbraR} />
        )}
        <dl className="metric-grid metric-grid-1 ecl-readout">
          {sv && (
            <>
              <div className="metric"><dt>{t('ecl_mag_solar')}</dt><dd className="num">{sv.magnitude.toFixed(3)}</dd></div>
              <div className="metric"><dt>{t('ecl_obsc')}</dt><dd className="num">{(sv.obscuration * 100).toFixed(1)}%</dd></div>
              <div className="metric"><dt>{t('ecl_sun_alt')}</dt><dd className="num">{sv.sunAlt.toFixed(1)}°</dd></div>
              {ev.gamma !== undefined && (
                <div className="metric"><dt>{t('ecl_gamma')}</dt><dd className="num">{ev.gamma.toFixed(3)}</dd></div>
              )}
            </>
          )}
          {lv && (
            <>
              <div className="metric"><dt>{t('ecl_mag_umbral')}</dt><dd className="num">{lv.umbralMag.toFixed(3)}</dd></div>
              <div className="metric"><dt>{t('ecl_mag_penum')}</dt><dd className="num">{lv.penumbralMag.toFixed(3)}</dd></div>
              <div className="metric"><dt>{t('ecl_greatest')}</dt><dd className="num">{fmtClock(ev.time)}</dd></div>
            </>
          )}
        </dl>
      </div>

      {solar && (
        <p className="ecl-status" data-ok={visible}>
          {visible ? t('ecl_visible') : local && local.view.sunAlt <= 0 ? t('ecl_below') : t('ecl_not_visible')}
        </p>
      )}

      <div className="ecl-timeline">
        <div className="ecl-timeline-head">
          <span>{t('ecl_timeline')}</span>
          <span className="num">{fmtDateTime(when, locale.date)}</span>
        </div>
        <div className="speed-row">
          <button className="chip-btn" onClick={() => setAnim((a) => !a)} aria-label={t(anim ? 'ecl_pause' : 'ecl_play')}>
            {anim ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input
            type="range" className="slider" min={-range} max={range} step={1} value={offset}
            onChange={(e) => { setAnim(false); setOffset(Number(e.target.value)); }}
            style={{ '--p': `${((offset + range) / (2 * range)) * 100}%` } as CSSProperties}
            aria-label={t('ecl_timeline')}
          />
          <span className="speed-chip num">{offset > 0 ? '+' : ''}{offset} min</span>
        </div>
      </div>

      <button className="btn-wide" onClick={() => onGoTo(when)}>{t('ecl_goto')}</button>
      <p className="muted small">{t(solar ? 'ecl_note_solar' : 'ecl_note_lunar')}</p>
      <p className="muted small">{t('ecl_accuracy')}</p>
    </div>
  );
}
