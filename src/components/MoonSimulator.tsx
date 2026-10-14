import { useMemo } from 'react';
import { fmtDateTime, useI18n, type TKey } from '../i18n';
import {
  findPhase,
  lunarState,
  moonAgeDays,
  moonAppearance,
  phaseIndex,
} from '../core/lunar';
import { MoonCanvas, MoonDisc } from './MoonCanvas';

/* ------------------------------------------------------------------ */
/*  موضع الشمس والقمر على دائرة البروج (قراءة موضعية محايدة)             */
/* ------------------------------------------------------------------ */
function EclipticDial({ sunLon, moonLon, elongation }: { sunLon: number; moonLon: number; elongation: number }) {
  const { t } = useI18n();
  const cx = 100, cy = 100, r = 76;
  const at = (lon: number, rad: number) => ({
    x: cx + rad * Math.cos((lon * Math.PI) / 180),
    y: cy - rad * Math.sin((lon * Math.PI) / 180),
  });
  const s = at(sunLon, r);
  const m = at(moonLon, r);
  const sep = elongation > 180 ? 360 - elongation : elongation;
  return (
    <figure className="dial-figure">
      <svg viewBox="0 0 200 200" className="dial-svg" role="img" aria-label={t('dial_title')}>
        <circle cx={cx} cy={cy} r={r} className="dial-ring" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = at(i * 30, r - 6);
          const b = at(i * 30, r + 4);
          const l = at(i * 30, r + 15);
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dial-tick" />
              <text x={l.x} y={l.y + 3} textAnchor="middle" className="dial-label">{i * 30}°</text>
            </g>
          );
        })}
        <line x1={s.x} y1={s.y} x2={m.x} y2={m.y} className="dial-link" />
        <circle cx={s.x} cy={s.y} r={7} className="dial-sun" />
        <circle cx={m.x} cy={m.y} r={5.5} className="dial-moon" />
      </svg>
      <figcaption>
        {t('dial_title')} · {t('dial_sep')} <span className="num">{sep.toFixed(1)}°</span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/*  اللوحة الكاملة                                                      */
/* ------------------------------------------------------------------ */
const PHASE_TARGETS = [
  { deg: 0, idx: 0 },
  { deg: 90, idx: 2 },
  { deg: 180, idx: 4 },
  { deg: 270, idx: 6 },
] as const;

export function MoonSimulator({
  date,
  elongation,
  latitudeDeg,
  longitudeDeg,
  onGoTo,
}: {
  date: Date;
  elongation: number;
  latitudeDeg: number;
  longitudeDeg: number;
  onGoTo: (d: Date) => void;
}) {
  const { t, locale } = useI18n();
  const southern = latitudeDeg < 0;
  const idx = phaseIndex(elongation);
  const age = useMemo(() => moonAgeDays(date), [date]);
  const st = useMemo(() => lunarState(date), [date]);
  const app = useMemo(() => moonAppearance(date, latitudeDeg, longitudeDeg), [date, latitudeDeg, longitudeDeg]);
  const diamArcmin = st.moonSemiDia * 2 * 60;

  const hourKey = Math.floor(date.getTime() / 3_600_000);
  const upcoming = useMemo(
    () =>
      PHASE_TARGETS.map((p) => ({ ...p, when: findPhase(new Date(hourKey * 3_600_000), p.deg) })).sort(
        (a, b) => a.when.getTime() - b.when.getTime(),
      ),
    [hourKey],
  );

  return (
    <div className="sim">
      <div className="sim-hero">
        <figure className="moon-figure">
          <div className="moon-stage">
            <MoonCanvas appearance={app} size={150} label={t(`phase_${idx}` as TKey)} />
          </div>
          <figcaption>{t('view_local')}</figcaption>
        </figure>
        <div className="sim-hero-side">
          <div className="phase-name">{t(`phase_${idx}` as TKey)}</div>
          <dl className="metric-grid metric-grid-1">
            <div className="metric">
              <dt>{t('m_illum')}</dt>
              <dd className="num">{(app.illumination * 100).toFixed(1)}%</dd>
            </div>
            <div className="metric">
              <dt>{t('m_age')}</dt>
              <dd className="num">{age.toFixed(1)} {t('unit_d')}</dd>
            </div>
            <div className="metric">
              <dt>{t('m_elong')}</dt>
              <dd className="num">{elongation.toFixed(1)}°</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="phase-strip" role="list">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} role="listitem" className="phase-strip-item" data-current={i === idx} title={t(`phase_${i}` as TKey)}>
            <MoonDisc elongation={i * 45} size={30} southern={southern} label={t(`phase_${i}` as TKey)} />
          </div>
        ))}
      </div>

      <EclipticDial sunLon={st.sunLon} moonLon={st.moonLon} elongation={elongation} />

      <div className="sim-section-title">{t('m_next')}</div>
      <ul className="event-list">
        {upcoming.map((p) => {
          const days = (p.when.getTime() - date.getTime()) / 86_400_000;
          return (
            <li key={p.deg} className="event-row">
              <MoonDisc elongation={p.deg} size={26} southern={southern} />
              <span className="event-main">
                <span className="event-title">{t(`phase_${p.idx}` as TKey)}</span>
                <span className="event-sub num">
                  {fmtDateTime(p.when, locale.date)} · {t('in_days', { n: days.toFixed(1) })}
                </span>
              </span>
              <button className="chip-btn" onClick={() => onGoTo(p.when)}>{t('go_to')}</button>
            </li>
          );
        })}
      </ul>

      <dl className="metric-grid">
        <div className="metric">
          <dt>{t('m_dist')}</dt>
          <dd className="num">{Math.round(st.moonDistKm).toLocaleString('en-US')} {t('unit_km')}</dd>
        </div>
        <div className="metric">
          <dt>{t('m_diam')}</dt>
          <dd className="num">{diamArcmin.toFixed(1)}′</dd>
        </div>
        <div className="metric">
          <dt>{t('m_lon')}</dt>
          <dd className="num">{st.moonLon.toFixed(2)}°</dd>
        </div>
        <div className="metric">
          <dt>{t('m_lat')}</dt>
          <dd className="num">{st.moonLat.toFixed(2)}°</dd>
        </div>
      </dl>
    </div>
  );
}
