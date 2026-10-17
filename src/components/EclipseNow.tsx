import { useMemo } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useSimulationStore } from '../state/store';
import { jumpTo } from '../state/jump';
import { eclipseTitle, findEclipsesBetween, lunarViewAt, solarViewAt, type EclipseEvent } from '../core/eclipses';
import { fmtDateLong, useI18n, type TKey } from '../i18n';
import { useSimDate } from '../hooks';
import { LiveView } from './EclipseLiveView';
import { sarosSeries } from '../core/saros';

/**
 * تبويب الكسوف والخسوف في بطاقة المعلومات: يعرض تلقائياً ما يجري في اللحظة الحالية من المحاكاة
 * (بلونه ومظهره)، وإلا يعرض الحدثين القادمين بزر للانتقال إلى ذروتهما.
 * التفاصيل الكاملة (سنوات، أوقات التماس، مسار الكسوف على الخريطة) في قائمة «الكسوف والخسوف».
 */
export function EclipseNow() {
  const { t, locale } = useI18n();
  const date = useSimDate(250);
  const observer = useSimulationStore((s) => s.observer);

  const obs = { latitudeDeg: observer.latitudeDeg, longitudeDeg: observer.longitudeDeg, elevationM: (observer as { elevationM?: number }).elevationM };
  const lunar = lunarViewAt(date, obs);
  const solar = solarViewAt(date, obs);
  const inLunar = lunar.phase !== 'none';
  const inSolar = solar.phase !== 'none' && solar.sun.altDeg > -0.9;

  const dayKey = Math.floor(date.getTime() / 86_400_000);
  const next = useMemo(() => {
    const start = new Date(dayKey * 86_400_000);
    const evs = findEclipsesBetween(start, new Date(start.getTime() + 900 * 86_400_000));
    const after = evs.filter((e) => e.peak.getTime() > date.getTime() - 3 * 3_600_000);
    return [after.find((e) => e.type === 'solar'), after.find((e) => e.type === 'lunar')].filter(Boolean) as EclipseEvent[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  return (
    <div className="sim">
      {inLunar && (
        <>
          <div className="eclnow-head"><Moon size={16} />{t('ecl_lunar')} · {t(`ev_phase_${lunar.phase}` as TKey)}</div>
          <LiveView kind="lunar" />
        </>
      )}
      {inSolar && (
        <>
          <div className="eclnow-head"><Sun size={16} />{t('ecl_solar')} · {t(`ev_phase_${solar.phase}` as TKey)}</div>
          <LiveView kind="solar" />
        </>
      )}
      {!inLunar && !inSolar && <p className="muted">{t('ev_none_now')}</p>}

      <div className="sim-section-title">{t('ecl_next')}</div>
      <ul className="event-list">
        {next.map((e) => (
          <li key={e.peak.getTime()} className="event-row">
            {e.type === 'solar' ? <Sun size={18} /> : <Moon size={18} />}
            <span className="event-main">
              <span className="event-title">{eclipseTitle(e)}</span>
              <span className="event-sub num">{fmtDateLong(e.peak, locale.date)} · {t('saros')} {sarosSeries(e.peak, e.type === 'solar' ? 'solar' : 'lunar')}</span>
            </span>
            <button className="chip-btn" onClick={() => jumpTo(e.peak)}>{t('ecl_go_peak')}</button>
          </li>
        ))}
      </ul>
      <p className="muted small">{t('ecl_details_hint')}</p>
    </div>
  );
}
