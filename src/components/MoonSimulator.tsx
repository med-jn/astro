import { useId, useMemo } from 'react';
import { fmtDateTime, useI18n, type TKey } from '../i18n';
import {
  findPhase,
  illuminationFromElongation,
  lunarState,
  moonAgeDays,
  phaseIndex,
  terminatorPath,
} from '../core/lunar';

const MOON_TEXTURE = '/images/moon.png';

/* ------------------------------------------------------------------ */
/*  قرص القمر بطوره الحقيقي (بنسيج أو بدونه)                            */
/* ------------------------------------------------------------------ */
export function MoonDisc({
  elongation,
  size = 160,
  textured = false,
  southern = false,
  label,
}: {
  elongation: number;
  size?: number;
  textured?: boolean;
  southern?: boolean;
  label?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const R = 50;
  const { d, mirror } = terminatorPath(elongation, R);
  return (
    <svg viewBox="-52 -52 104 104" width={size} height={size} role="img" aria-label={label}>
      <defs>
        <clipPath id={`clip${uid}`}>
          <circle r={R} />
        </clipPath>
        <radialGradient id={`lit${uid}`} cx="40%" cy="38%" r="75%">
          <stop offset="0" stopColor="#f3f5f8" />
          <stop offset="1" stopColor="#a9b2be" />
        </radialGradient>
        <filter id={`soft${uid}`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={textured ? 1.1 : 0.5} />
        </filter>
      </defs>
      <g transform={southern ? 'rotate(180)' : undefined}>
        <g clipPath={`url(#clip${uid})`}>
          {textured ? (
            <>
              <circle r={R} fill="#8d96a3" />
              <image href={MOON_TEXTURE} x={-R} y={-R} width={2 * R} height={2 * R} preserveAspectRatio="xMidYMid slice" />
            </>
          ) : (
            <circle r={R} fill={`url(#lit${uid})`} />
          )}
          {/* الجزء المظلم: يبقى النسيج خافتاً تحته ليمثل الضوء الرمادي (earthshine) */}
          <g transform={mirror ? 'scale(-1 1)' : undefined}>
            <path d={d} fill="#04060a" fillOpacity={0.88} filter={`url(#soft${uid})`} />
          </g>
        </g>
        <circle r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={0.8} />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  مخطط المدار: الأرض في المركز والشمس نحو اليمين                      */
/* ------------------------------------------------------------------ */
function OrbitDiagram({ elongation }: { elongation: number }) {
  const { t } = useI18n();
  const r = 56;
  const rad = (elongation * Math.PI) / 180;
  const mx = 100 + r * Math.cos(rad);
  const my = 70 - r * Math.sin(rad); // عكس عقارب الساعة كما يُرى من الشمال السماوي
  return (
    <svg viewBox="0 0 200 140" className="orbit-svg" role="img" aria-label={t('orbit_title')}>
      {/* أشعة الشمس */}
      {[-40, -20, 0, 20, 40].map((y) => (
        <line key={y} x1={196} y1={70 + y} x2={150} y2={70 + y} className="orbit-ray" />
      ))}
      <text x={194} y={14} textAnchor="end" className="orbit-text">
        {t('orbit_sun')} ›
      </text>
      <circle cx={100} cy={70} r={r} className="orbit-path" />
      <circle cx={100} cy={70} r={9} className="orbit-earth" />
      <line x1={100} y1={70} x2={mx} y2={my} className="orbit-link" />
      {/* القمر: نصفه المواجه للشمس مضيء دائماً */}
      <g transform={`translate(${mx} ${my})`}>
        <circle r={6.5} className="orbit-moon-dark" />
        <path d="M 0 -6.5 A 6.5 6.5 0 0 1 0 6.5 Z" className="orbit-moon-lit" />
      </g>
      <text x={6} y={134} className="orbit-text">
        {t('orbit_note')}
      </text>
    </svg>
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
  onGoTo,
}: {
  date: Date;
  elongation: number;
  latitudeDeg: number;
  onGoTo: (d: Date) => void;
}) {
  const { t, locale } = useI18n();
  const southern = latitudeDeg < 0;
  const idx = phaseIndex(elongation);
  const illum = illuminationFromElongation(elongation);
  const age = moonAgeDays(elongation);
  const st = useMemo(() => lunarState(date), [date]);
  const diamArcmin = st.moonSemiDia * 2 * 60;

  // الأطوار القادمة: تُعاد حسابها كل ساعة محاكاة فقط
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
          <MoonDisc elongation={elongation} size={168} textured southern={southern} label={t(`phase_${idx}` as TKey)} />
          <figcaption>{t(southern ? 'view_south' : 'view_north')}</figcaption>
        </figure>
        <div className="sim-hero-side">
          <div className="phase-name">{t(`phase_${idx}` as TKey)}</div>
          <dl className="metric-grid metric-grid-1">
            <div className="metric">
              <dt>{t('m_illum')}</dt>
              <dd className="num">{(illum * 100).toFixed(1)}%</dd>
            </div>
            <div className="metric">
              <dt>{t('m_age')}</dt>
              <dd className="num">
                {age.toFixed(1)} {t('unit_d')}
              </dd>
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
          <div key={i} role="listitem" className="phase-strip-item" data-current={i === idx}>
            <MoonDisc elongation={i * 45} size={30} label={t(`phase_${i}` as TKey)} southern={southern} />
          </div>
        ))}
      </div>

      <div className="sim-section-title">{t('orbit_title')}</div>
      <OrbitDiagram elongation={elongation} />

      <div className="sim-section-title">{t('m_next')}</div>
      <ul className="event-list">
        {upcoming.map((p) => {
          const days = (p.when.getTime() - date.getTime()) / 86_400_000;
          return (
            <li key={p.deg} className="event-row">
              <MoonDisc elongation={p.deg} size={26} label="" southern={southern} />
              <span className="event-main">
                <span className="event-title">{t(`phase_${p.idx}` as TKey)}</span>
                <span className="event-sub num">
                  {fmtDateTime(p.when, locale.date)} · {t('in_days', { n: days.toFixed(1) })}
                </span>
              </span>
              <button className="chip-btn" onClick={() => onGoTo(p.when)}>
                {t('go_to')}
              </button>
            </li>
          );
        })}
      </ul>

      <dl className="metric-grid">
        <div className="metric">
          <dt>{t('m_dist')}</dt>
          <dd className="num">
            {Math.round(st.moonDistKm).toLocaleString('en-US')} {t('unit_km')}
          </dd>
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
