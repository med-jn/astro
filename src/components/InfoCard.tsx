import { useMemo, useState } from 'react';
import { ChevronUp, Sun, Timer } from 'lucide-react';
import type { RenderOutput } from '../render/skyRenderer';
import { getMansionByEclipticLongitude } from '../core/mansions';
import { useSimulationStore } from '../state/store';
import { getGroupById, getGroupAliases, getGroupMembers } from '../core/starGroups';
import { fmtDeg, hoursToHMS, useI18n, type TKey } from '../i18n';
import { mansionName } from '../i18n/names';
import { lunarState, norm360, phaseIndex } from '../core/lunar';
import { MoonDisc } from './MoonCanvas';
import { MoonSimulator } from './MoonSimulator';
import { useSettings } from '../settings';
import { EclipseSimulator } from './EclipseSimulator';

interface Props {
  output: RenderOutput | null;
}

type Tab = 'moon' | 'eclipse' | 'data';

export function InfoCard({ output }: Props) {
  const { t, lang } = useI18n();
  const { showInfoCard } = useSettings();
  const selectedGroupIds = useSimulationStore((s) => s.selectedGroupIds);
  const date = useSimulationStore((s) => s.date);
  const observer = useSimulationStore((s) => s.observer);
  const setDate = useSimulationStore((s) => s.setDate);

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('moon');

  const sunLon = output?.sun.ecliptic?.longitudeDeg;
  const moonLon = output?.moon.ecliptic?.longitudeDeg;

  const sunMansion = useMemo(() => (sunLon === undefined ? null : getMansionByEclipticLongitude(sunLon)), [sunLon]);
  const moonMansion = useMemo(() => (moonLon === undefined ? null : getMansionByEclipticLongitude(moonLon)), [moonLon]);

  // الاستطالة من نفس إحداثيات الخريطة ليتطابق ما يُعرض هنا مع ما يُرسم، وإلا نحسبها ذاتياً
  const elongation = useMemo(
    () => (sunLon !== undefined && moonLon !== undefined ? norm360(moonLon - sunLon) : lunarState(date).elongation),
    [sunLon, moonLon, date],
  );

  if (!output || !showInfoCard) return null;

  const illumPct = Math.round((output.moon.phaseFraction ?? 0) * 100);
  const pIdx = phaseIndex(elongation);
  const southern = observer.latitudeDeg < 0;

  const group = selectedGroupIds.length ? getGroupById(selectedGroupIds[selectedGroupIds.length - 1]) : undefined;
  const aliases = group ? getGroupAliases(group.id) : [];
  const starCount = group ? getGroupMembers(group.id).length : 0;
  const seasonKey = group?.season ? (`season_${group.season}` as TKey) : null;
  const season = seasonKey ? t(seasonKey) : null;
  const groupName = group ? (lang === 'en' && group.nameEn ? group.nameEn : group.nameAr) : '';

  const mName = (m: typeof sunMansion) => (m ? mansionName(m, lang) : '—');
  const st = lunarState(date);

  return (
    <section className="info-card" data-expanded={expanded} aria-live="polite" aria-label={t('info_title')}>
      <header className="info-head">
        <span className="info-title">{t('info_title')}</span>
        <button
          className="info-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'info_collapse' : 'info_expand')}
          title={t(expanded ? 'info_collapse' : 'info_expand')}
        >
          <ChevronUp size={16} className="info-chevron" />
        </button>
      </header>

      <div className="info-scroll">
        {group && (
          <div className="info-block">
            <div className="info-row">
              <span className="badge">✦</span>
              <span className="info-label">{t('grp_constellation')}</span>
              <span className="info-value">
                {groupName}
                {lang === 'ar' && group.nameEn ? ` · ${group.nameEn}` : ''}
              </span>
            </div>
            {aliases.length > 0 && (
              <div className="info-row">
                <span className="info-label">{t('grp_aka')}</span>
                <span className="info-value">{aliases.join(lang === 'ar' ? '، ' : ', ')}</span>
              </div>
            )}
            {group.figureAr && lang === 'ar' && (
              <div className="info-row">
                <span className="info-label">{t('grp_figure')}</span>
                <span className="info-value">{group.figureAr}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">{t('grp_stars')}</span>
              <span className="info-value">
                {starCount}
                {season ? ` · ${t('grp_season', { s: season })}` : ''}
              </span>
            </div>
          </div>
        )}

        <div className="info-block">
          <div className="info-row">
            <span className="badge badge-sun"><Sun size={14} /></span>
            <span className="info-label">{t('sun_mansion')}</span>
            <span className="info-value">
              {mName(sunMansion)} <span className="num">({(sunMansion?.index ?? 0) + 1})</span> ·{' '}
              {t('decl')} <span className="num">{fmtDeg(output.sun.equatorial.declinationDeg)}</span>
            </span>
          </div>
          <div className="info-row">
            <span className="badge badge-moon">
              <MoonDisc elongation={elongation} size={20} southern={southern} />
            </span>
            <span className="info-label">{t('moon_mansion')}</span>
            <span className="info-value">
              {mName(moonMansion)} <span className="num">({(moonMansion?.index ?? 0) + 1})</span> ·{' '}
              <span className="num">{illumPct}%</span> {t('illum')}
            </span>
          </div>
          <div className="info-row">
            <span className="badge badge-time"><Timer size={14} /></span>
            <span className="info-label">{t('sidereal')}</span>
            <span className="info-value">
              {t('gmst')} <span className="num">{hoursToHMS(output.gmstDeg / 15)}</span>
            </span>
          </div>
        </div>

        {expanded && (
          <div className="info-expanded">
            <div className="tabs" role="tablist">
              {(['moon', 'eclipse', 'data'] as Tab[]).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => setTab(k)}>
                  {t(`tab_${k}` as TKey)}
                </button>
              ))}
            </div>

            <div className="tab-panel" role="tabpanel">
              {tab === 'moon' && (
                <MoonSimulator date={date} elongation={elongation} latitudeDeg={observer.latitudeDeg} longitudeDeg={observer.longitudeDeg} onGoTo={setDate} />
              )}
              {tab === 'eclipse' && (
                <EclipseSimulator
                  date={date}
                  latitudeDeg={observer.latitudeDeg}
                  longitudeDeg={observer.longitudeDeg}
                  onGoTo={setDate}
                />
              )}
              {tab === 'data' && (
                <dl className="metric-grid">
                  <div className="metric"><dt>{t('d_sun')} · {t('d_sun_lon')}</dt><dd className="num">{(sunLon ?? st.sunLon).toFixed(3)}°</dd></div>
                  <div className="metric"><dt>{t('d_sun')} · {t('d_sun_dec')}</dt><dd className="num">{output.sun.equatorial.declinationDeg.toFixed(3)}°</dd></div>
                  <div className="metric"><dt>{t('d_sun')} · {t('d_sun_dist')}</dt><dd className="num">{st.sunDistAU.toFixed(5)}</dd></div>
                  <div className="metric"><dt>{t('d_gmst')}</dt><dd className="num">{hoursToHMS(output.gmstDeg / 15)}</dd></div>
                  <div className="metric"><dt>{t('d_moon')} · {t('m_lon')}</dt><dd className="num">{(moonLon ?? st.moonLon).toFixed(3)}°</dd></div>
                  <div className="metric"><dt>{t('d_moon')} · {t('m_lat')}</dt><dd className="num">{st.moonLat.toFixed(3)}°</dd></div>
                  <div className="metric"><dt>{t('m_elong')}</dt><dd className="num">{elongation.toFixed(3)}°</dd></div>
                  <div className="metric"><dt>{t('m_illum')}</dt><dd className="num">{illumPct}% · {t(`phase_${pIdx}` as TKey)}</dd></div>
                </dl>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
