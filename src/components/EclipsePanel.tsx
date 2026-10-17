import { useMemo, useState } from 'react';
import { Moon, Play, MapPin, Crosshair } from 'lucide-react';
import { useSimulationStore } from '../state/store';
import {
  findEclipsesBetween, eclipseTitle, localSolarCircumstances, localLunarCircumstances,
  lunarEclipseTags,
  type EclipseEvent, type SolarEclipseEvent, type LunarEclipseEvent,
  type LocalSolarCircumstances, type LocalLunarCircumstances,
} from '../core/eclipses';
import { jumpTo, playFrom } from '../state/jump';
import { useSimDate } from '../hooks';
import { Flyout, NavRow } from './ui';
import { currentLocale, useI18n, type TKey } from '../i18n';
import { LiveView } from './EclipseLiveView';
import { sarosSeries } from '../core/saros';

function fmtDate(d: Date): string {
  return d.toLocaleDateString(currentLocale().date, { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtUT(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}
function fmtTime(d: Date, withSeconds = false): string {
  return d.toLocaleTimeString(currentLocale().date, { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });
}

interface Row {
  event: EclipseEvent;
  solar?: LocalSolarCircumstances | null;
  lunar?: LocalLunarCircumstances;
}

// ============================= اللوحة =============================

type Tab = 'solar' | 'lunar';

const css = {
  seg: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 3, borderRadius: 10, background: 'rgba(148,163,184,0.12)' } as const,
  segBtn: (on: boolean) => ({
    padding: '7px 6px', borderRadius: 8, border: 0, cursor: 'pointer', fontSize: '0.9em', fontFamily: 'inherit',
    color: on ? '#fff' : 'inherit', background: on ? 'var(--accent)' : 'transparent',
  }) as const,
  card: { padding: '8px 10px', borderRadius: 10, background: 'rgba(148,163,184,0.09)', display: 'grid', gap: 5 } as const,
  h: { fontSize: '0.74em', letterSpacing: 0, opacity: 0.65, margin: '2px 0 0' } as const,
  kv: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.84em' } as const,
};

function KV({ k, v }: { k: string; v: string }) {
  return <div style={css.kv}><span style={{ opacity: 0.7 }}>{k}</span><span style={{ textAlign: 'left', direction: 'ltr', unicodeBidi: 'plaintext' }}>{v}</span></div>;
}

function visInfo(vis: string | undefined): { key: TKey; color: string } {
  if (vis === 'full') return { key: 'ep_vis_full', color: '#6fcf97' };
  if (vis === 'partial') return { key: 'ep_vis_partial', color: '#e5b94d' };
  return { key: 'ep_vis_none', color: '#7b8798' };
}

export function EclipsePanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('solar');
  const [sel, setSel] = useState<number | null>(null); // peakMs للحدث المفتوح

  const date = useSimDate(500);
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
      <NavRow icon={Moon} title={t('ep_title')} active={open || !!focus} badge={!!focus} onClick={() => setOpen((v) => !v)} />
      {open && (
        <Flyout icon={Moon} title={t('ep_title')} onClose={() => setOpen(false)}>
          <div style={{ display: 'grid', gap: 10 }}>
            {!current ? (
              <>
                <div className="stepper-row">
                  <span className="stepper-label">{t('f_year')}</span>
                  <div className="stepper-controls">
                    <button className="stepper-btn" onClick={() => setYear(y - 1)}>−</button>
                    <span className="stepper-value">{y}</span>
                    <button className="stepper-btn" onClick={() => setYear(y + 1)}>+</button>
                  </div>
                </div>

                <div style={css.seg} role="tablist">
                  <button role="tab" aria-selected={tab === 'solar'} style={css.segBtn(tab === 'solar')} onClick={() => setTab('solar')}>{t('ep_tab_solar', { n: nSolar })}</button>
                  <button role="tab" aria-selected={tab === 'lunar'} style={css.segBtn(tab === 'lunar')} onClick={() => setTab('lunar')}>{t('ep_tab_lunar', { n: nLunar })}</button>
                </div>

                {focus && (
                  <button className="clear-btn" onClick={() => useSimulationStore.getState().setEclipseFocus(null)}>
                    {t('ep_hide_path')}
                  </button>
                )}

                <div style={{ display: 'grid', gap: 6 }}>
                  {list.length === 0 && <div style={{ opacity: 0.7, padding: 8 }}>{t(tab === 'solar' ? 'ep_none_solar' : 'ep_none_lunar')}</div>}
                  {list.map((r) => {
                    const e = r.event;
                    const solar = e.type === 'solar';
                    const v = visInfo(solar ? r.solar?.visibility : r.lunar?.visibility);
                    const horizontal = !solar && !!r.lunar?.horizontal;
                    const tags = solar ? [] : lunarEclipseTags(e as LunarEclipseEvent);
                    return (
                      <button key={e.peak.getTime()} className="select-item" aria-pressed={focus?.peakMs === e.peak.getTime()} onClick={() => choose(r)}
                        style={{ display: 'grid', gap: 3, textAlign: 'start', opacity: v.color === '#7b8798' ? 0.8 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <strong style={{ fontWeight: 600 }}>{eclipseTitle(e)}</strong>
                          <span style={{ fontSize: '0.78em', color: v.color }}>● {t(v.key)}</span>
                        </div>
                        <div style={{ fontSize: '0.8em', opacity: 0.75 }}>
                          {fmtDate(e.peak)} · {fmtTime(e.peak)}
                        </div>
                        {(tags.length > 0 || horizontal) && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {tags.map((tg) => <span key={tg} style={{ fontSize: '0.7em', padding: '1px 7px', borderRadius: 8, background: 'rgba(148,163,184,0.22)' }}>{t(`tag_${tg}` as TKey)}</span>)}
                            {horizontal && <span style={{ fontSize: '0.7em', padding: '1px 7px', borderRadius: 8, background: 'var(--accent)', color: '#fff' }}>{t('ep_horizontal_badge')}</span>}
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
              {t('ep_footnote')}
            </div>
          </div>
        </Flyout>
      )}
    </div>
  );
}

function Detail({ row, onBack }: { row: Row; onBack: () => void }) {
  const { t } = useI18n();
  const e = row.event;
  const solar = e.type === 'solar';
  const focus = useSimulationStore((s) => s.eclipseFocus);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button className="clear-btn" onClick={onBack} style={{ width: 'auto', padding: '4px 10px' }}>{t('ep_back')}</button>
        <div style={{ textAlign: 'end' }}>
          <div style={{ fontWeight: 600 }}>{eclipseTitle(e)}</div>
          <div style={{ fontSize: '0.78em', opacity: 0.75 }}>{fmtDate(e.peak)} · {t('saros')} {sarosSeries(e.peak, solar ? 'solar' : 'lunar')}</div>
        </div>
      </div>
      {solar
        ? <SolarDetails e={e as SolarEclipseEvent} loc={row.solar ?? null} />
        : <LunarDetails e={e as LunarEclipseEvent} loc={row.lunar} />}
      {focus && (
        <button className="clear-btn" onClick={() => useSimulationStore.getState().setEclipseFocus(null)}>{t('ep_hide_path')}</button>
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
  const { t } = useI18n();
  const dur = (sec: number) => t('dur_fmt', { m: Math.floor(sec / 60), s: Math.round(sec % 60) });
  const setObserver = useSimulationStore((s) => s.setObserver);
  const contacts: [string, { time: Date; altitudeDeg: number } | undefined][] = loc ? [
    [t('ep_s_c1'), loc.c1],
    [t('ep_s_c2'), loc.c2],
    [t('ep_s_max'), loc.max],
    [t('ep_s_c3'), loc.c3],
    [t('ep_s_c4'), loc.c4],
  ] : [];
  return (
    <>
      <div style={css.card}>
        <div style={css.h}>{t('ep_global')}</div>
        <KV k={t('ep_s_max')} v={`${fmtUT(e.peak)} UT`} />
        <KV k={t('ep_mag')} v={Number.isFinite(e.magnitude) ? e.magnitude.toFixed(4) : '—'} />
        <KV k="γ" v={e.gamma.toFixed(4)} />
        {e.greatestDurationSec ? <KV k={t('ep_longest')} v={dur(e.greatestDurationSec)} /> : null}
        <KV k={t('ep_greatest_point')} v={`${e.greatest.latDeg.toFixed(2)}°, ${e.greatest.lonDeg.toFixed(2)}°`} />
        {!e.central && e.kind !== 'partial' ? <KV k={t('ep_note')} v={t('ep_noncentral_note')} /> : null}
      </div>

      <div style={css.card}>
        <div style={css.h}>{t('ep_here')}</div>
        {loc ? (
          <>
            <KV k={t('ep_type')} v={t(loc.kind === 'total' ? 'ecl_total' : loc.kind === 'annular' ? 'ecl_annular' : 'ecl_partial')} />
            <KV k={t('ep_mag')} v={loc.magnitude.toFixed(3)} />
            <KV k={t('ecl_obsc')} v={`${(loc.obscuration * 100).toFixed(1)}%`} />
            {loc.centralDurationSec ? <KV k={t('ep_central_dur')} v={dur(loc.centralDurationSec)} /> : null}
            <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
              {contacts.map(([label, p]) => p ? (
                <ContactBtn key={label} label={label} time={p.time} extra={`${p.altitudeDeg.toFixed(0)}°`} />
              ) : null)}
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.75, fontSize: '0.84em' }}>
            {t('ep_not_visible_note')}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        {loc && (
          <button className="select-item" onClick={() => playFrom(new Date(loc.c1.time.getTime() - 5 * 60000))}>
            <Play size={13} /> {t('ep_play_solar')}
          </button>
        )}
        <button className="select-item" onClick={() => setObserver({ latitudeDeg: e.greatest.latDeg, longitudeDeg: e.greatest.lonDeg })}>
          <Crosshair size={13} /> {t('ep_move_greatest')}
        </button>
      </div>

      <LiveView kind="solar" />
    </>
  );
}

function LunarDetails({ e, loc }: { e: LunarEclipseEvent; loc?: LocalLunarCircumstances }) {
  const { t } = useI18n();
  return (
    <>
      <div style={css.card}>
        <div style={css.h}>{t('ep_global')}</div>
        <KV k={t('ep_c_MAX')} v={`${fmtUT(e.peak)} UT`} />
        <KV k={t('ecl_mag_lunar')} v={e.umbralMagnitude.toFixed(4)} />
        <KV k={t('ecl_mag_dim')} v={e.penumbralMagnitude.toFixed(4)} />
        <KV k="γ" v={e.gamma.toFixed(4)} />
      </div>

      <div style={css.card}>
        <div style={css.h}>{t('ep_moments')}</div>
        {loc?.contacts.length ? (
          <div style={{ display: 'grid', gap: 4 }}>
            {loc.contacts.map((c) => (
              <ContactBtn key={c.key} label={t(`ep_c_${c.key}` as TKey)} time={c.time}
                extra={c.moonUp ? t('ep_moon_alt_inline', { alt: c.moonAltDeg.toFixed(0) }) : t('ep_below')} />
            ))}
          </div>
        ) : <div style={{ opacity: 0.75, fontSize: '0.84em' }}>{t('ep_no_moments')}</div>}
        {loc?.horizontal && (
          <button className="select-item" style={{ fontSize: '0.84em' }}
            onClick={() => jumpTo(new Date((loc.horizontal!.start.getTime() + loc.horizontal!.end.getTime()) / 2))}>
            <MapPin size={13} /> {t('ep_horizontal_label')} {fmtTime(loc.horizontal.start, true)} – {fmtTime(loc.horizontal.end, true)}
            {' '}· {t('ep_max_mag', { m: loc.horizontal.maxUmbralMagnitude.toFixed(2) })}
          </button>
        )}
      </div>

      <button className="select-item" onClick={() => playFrom(new Date(e.peak.getTime() - 3.5 * 3600 * 1000))}>
        <Play size={13} /> {t('ep_play_lunar')}
      </button>

      <LiveView kind="lunar" />
    </>
  );
}
