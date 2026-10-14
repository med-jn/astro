import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { Moon, Pause, Play, Sun } from 'lucide-react';
import { fmtClock, fmtDateLong, fmtDateTime, useI18n, type TKey } from '../i18n';
import { useSettings } from '../settings';
import {
  findEclipses,
  lunarContacts,
  lunarViewAt,
  moonAppearance,
  solarLocalInfo,
  solarViewAt,
  type Contact,
  type EclipseEvent,
} from '../core/lunar';
import { DEFAULT_LOOK, ECLIPSE_LOOKS } from '../core/eclipseLooks';
import { MoonCanvas } from './MoonCanvas';

/*
 * عرض محايد: تُعرض الظاهرة كما تُرى في السماء (قرص مضيء ومنطقة مظلمة عليه) دون رسم أي جرم
 * أو شكل آخر خارج القرص المرصود، ودون نسبة الظاهرة إلى سبب بعينه.
 */

const C = 120;
const MIN = 60_000;

/* ------------------------------------------------------------------ */
/*  كسوف الشمس: قرص الشمس وجزؤه المظلم                                  */
/* ------------------------------------------------------------------ */
function SolarDisc({ x, y, sunR, darkR, magnitude, sunAlt, q }: {
  x: number; y: number; sunR: number; darkR: number; magnitude: number; sunAlt: number; q: number;
}) {
  const uid = useId().replace(/:/g, '');
  const scale = 200;
  const sr = sunR * scale;
  const dr = darkR * scale;
  const night = sunAlt <= 0;
  const total = magnitude >= 0.999;
  return (
    <svg viewBox="0 0 240 240" className="ecl-svg" role="img">
      <defs>
        <clipPath id={`view${uid}`}><circle cx={C} cy={C} r={114} /></clipPath>
        <clipPath id={`sun${uid}`}><circle cx={C} cy={C} r={sr} /></clipPath>
        <radialGradient id={`face${uid}`}>
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset="0.75" stopColor="#ffd766" />
          <stop offset="1" stopColor="#f0a23a" />
        </radialGradient>
        <radialGradient id={`glow${uid}`}>
          <stop offset="0.3" stopColor="#fff4d0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff4d0" stopOpacity="0" />
        </radialGradient>
        <filter id={`soft${uid}`}><feGaussianBlur stdDeviation="0.7" /></filter>
      </defs>
      <g clipPath={`url(#view${uid})`}>
        <rect width="240" height="240" fill={night ? '#05070a' : '#0d1a2e'} />
        <g transform={`rotate(${q.toFixed(1)} ${C} ${C})`}>
          <circle cx={C} cy={C} r={sr * (total ? 3.2 : 2)} fill={`url(#glow${uid})`} opacity={total ? 0.85 : 0.28} />
          <circle cx={C} cy={C} r={sr} fill={`url(#face${uid})`} />
          {/* الجزء المظلم يُقصّ على القرص نفسه فلا يظهر شيء خارجه */}
          <g clipPath={`url(#sun${uid})`}>
            <circle cx={C + x * scale} cy={C + y * scale} r={dr} fill="#04060a" filter={`url(#soft${uid})`} />
          </g>
        </g>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  اللوحة الكاملة                                                      */
/* ------------------------------------------------------------------ */
export function EclipseSimulator({ date, latitudeDeg, longitudeDeg, onGoTo }: {
  date: Date; latitudeDeg: number; longitudeDeg: number; onGoTo: (d: Date) => void;
}) {
  const { t, locale } = useI18n();
  const { hour12 } = useSettings();
  const dayKey = Math.floor(date.getTime() / 86_400_000);
  const events = useMemo(() => findEclipses(new Date(dayKey * 86_400_000), 6), [dayKey]);

  const [sel, setSel] = useState(0);
  const [offset, setOffset] = useState(0);
  const [anim, setAnim] = useState(false);
  const [lookId, setLookId] = useState(DEFAULT_LOOK.id);

  const ev: EclipseEvent | undefined = events[Math.min(sel, events.length - 1)];
  const solar = ev?.kind === 'solar';

  const local = useMemo(
    () => (ev && solar ? solarLocalInfo(ev, latitudeDeg, longitudeDeg) : null),
    [ev, solar, latitudeDeg, longitudeDeg],
  );
  const center = solar ? (local ? local.peak : ev?.time) : ev?.time;
  const contacts: Contact[] = useMemo(
    () => (!ev ? [] : solar ? local?.contacts ?? [] : lunarContacts(ev)),
    [ev, solar, local],
  );

  // نطاق الشريط الزمني: يغطي كل المراحل مع هامش
  const range = useMemo(() => {
    if (!center) return 150;
    const span = contacts.reduce((m, c) => Math.max(m, Math.abs(c.time.getTime() - center.getTime()) / MIN), 0);
    return Math.min(300, Math.ceil((span || (solar ? 90 : 180)) + 12));
  }, [contacts, center, solar]);

  useEffect(() => {
    if (!anim) return;
    const id = setInterval(() => setOffset((o) => (o + 2 > range ? -range : o + 2)), 60);
    return () => clearInterval(id);
  }, [anim, range]);

  if (!ev || !center) return <p className="muted">{t('ecl_none')}</p>;

  const when = new Date(center.getTime() + offset * MIN);
  const sv = solar ? solarViewAt(when, latitudeDeg, longitudeDeg) : null;
  const lv = !solar ? lunarViewAt(when) : null;
  const app = !solar ? moonAppearance(when, latitudeDeg, longitudeDeg) : null;
  const look = ECLIPSE_LOOKS.find((l) => l.id === lookId) ?? DEFAULT_LOOK;
  const eclipseSep = lv ? lv.sep : 99;
  const haloScale = eclipseSep < 1.3 ? Math.max(0.1, (eclipseSep - 0.35) / 0.95) : 1; // كما في الكانفاس الرئيسي

  const select = (i: number) => { setSel(i); setOffset(0); setAnim(false); };
  const jumpTo = (c: Contact) => {
    setAnim(false);
    setOffset(Math.max(-range, Math.min(range, Math.round((c.time.getTime() - center.getTime()) / MIN))));
  };
  const contactLabel = (c: Contact): string => {
    if (c.key === 'solCentralStart' || c.key === 'solCentralEnd') {
      return t(`ct_${c.key}_${local?.type === 'annular' ? 'annular' : 'total'}` as TKey);
    }
    return t(`ct_${c.key}` as TKey);
  };
  const sameDay = (d: Date) => d.toDateString() === center.toDateString();
  const hasUmbral = !solar && ev.type !== 'faint';

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
        <div className="ecl-visual">
          {sv && (
            <SolarDisc x={sv.x} y={sv.y} sunR={sv.sunR} darkR={sv.darkR} magnitude={sv.magnitude} sunAlt={sv.sunAlt} q={sv.q} />
          )}
          {lv && app && (
            <MoonCanvas
              appearance={app}
              size={170}
              haloScale={haloScale}
              dark={{ cx: lv.cx, cy: lv.cy, coreR: lv.coreR / lv.moonR, haloR: lv.haloR / lv.moonR, look }}
              label={t('ecl_lunar')}
            />
          )}
        </div>
        <dl className="metric-grid metric-grid-1 ecl-readout">
          {sv && (
            <>
              <div className="metric"><dt>{t('ecl_mag_solar')}</dt><dd className="num">{sv.magnitude.toFixed(3)}</dd></div>
              <div className="metric"><dt>{t('ecl_obsc')}</dt><dd className="num">{(sv.obscuration * 100).toFixed(1)}%</dd></div>
              <div className="metric"><dt>{t('ecl_sun_alt')}</dt><dd className="num">{sv.sunAlt.toFixed(1)}°</dd></div>
            </>
          )}
          {lv && (
            <>
              <div className="metric"><dt>{t('ecl_mag_lunar')}</dt><dd className="num">{Math.max(0, lv.magnitude).toFixed(3)}</dd></div>
              <div className="metric"><dt>{t('ecl_mag_dim')}</dt><dd className="num">{Math.max(0, lv.dimMagnitude).toFixed(3)}</dd></div>
            </>
          )}
        </dl>
      </div>

      {solar && (
        <p className="ecl-status" data-ok={!!local?.visible}>
          {!local ? t('ecl_not_visible') : local.visible ? t('ecl_visible') : t('ecl_below')}
        </p>
      )}

      {hasUmbral && (
        <div className="section">
          <div className="section-title">{t('look_title')}</div>
          <div className="look-row" role="radiogroup" aria-label={t('look_title')}>
            {ECLIPSE_LOOKS.map((l) => (
              <button
                key={l.id}
                role="radio"
                aria-checked={l.id === look.id}
                className="look-chip"
                data-selected={l.id === look.id}
                onClick={() => setLookId(l.id)}
                title={t(`look_${l.id}` as TKey)}
              >
                <span className="look-dot" style={{ background: l.swatch }} />
                <span>{t(`look_${l.id}` as TKey)}</span>
              </button>
            ))}
          </div>
          <p className="muted small">{t('look_note')}</p>
        </div>
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

      {contacts.length > 0 && (
        <div className="section">
          <div className="section-title">{t('contacts_title')}</div>
          <ul className="event-list">
            {contacts.map((c) => (
              <li key={c.key}>
                <button className="event-row event-select" onClick={() => jumpTo(c)} data-selected={Math.abs(c.time.getTime() - when.getTime()) < MIN}>
                  <span className="event-main">
                    <span className="event-title">{contactLabel(c)}</span>
                    <span className="event-sub num">
                      {sameDay(c.time) ? '' : `${fmtDateLong(c.time, locale.date)} · `}{fmtClock(c.time, hour12)}
                      {c.altitude !== undefined ? ` · ${c.altitude.toFixed(0)}°` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="btn-wide" onClick={() => onGoTo(when)}>{t('ecl_goto')}</button>
      <p className="muted small">{t(solar ? 'ecl_note_solar' : 'ecl_note_lunar')}</p>
    </div>
  );
}
