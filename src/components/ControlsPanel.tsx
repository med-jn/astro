import { memo, useEffect, useState, type CSSProperties, type ElementType } from 'react';
import {
  Play, Pause, Clock, MapPinned, LocateFixed, Globe2, Contrast, Orbit, Route, Radar,
  CircleDot, Star, Disc, Tag, Compass, Sparkles, X, RotateCcw, Moon,
  Grid3x3, Clock3, Telescope, Eye, Menu, Settings as SettingsIcon, Info, Sun, Maximize,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { SPEED_LABELS_AR, useSimulationStore, type LayerToggles } from '../state/store';
import { useSimDate } from '../hooks';
import { ZODIAC_ORDER, type ZodiacKey } from '../core/zodiac';
import { getZodiacNameAr } from '../core/zodiacNamesAr';
import { PLANET_LABELS_AR, PLANET_NAMES } from '../core/bodies';
import { getAllLunarMansions } from '../core/mansions';
import { findPhase } from '../core/lunar';
import { fmtClock, fmtDateLong, monthName, toInputValue, useI18n, type TKey } from '../i18n';
import { CITIES, mansionName, zodiacName } from '../i18n/names';
import { formatCoord, resetSettings, updateSettings, useSettings } from '../settings';
import { StarSearchBar } from './StarSearchBar';
import { Flyout, Segmented, Section, NavRow, SwitchRow, StepperRow, CoordField } from './ui';
import { LookPicker } from './EclipseLiveView';
import { EclipsePanel } from './EclipsePanel';
import { useEyeStore, type LookKind } from '../state/eye';
import { ShortcutsGuide } from './ShortcutsGuide';
import { OPEN_SHORTCUTS_EVENT } from './GlobalShortcuts';
import { fovLimits, type ProjectionKind } from '../core/camera';

/* ------------------------------------------------------------------ */
/*  ثوابت                                                               */
/* ------------------------------------------------------------------ */
const LAYER_ICONS: Record<keyof LayerToggles, ElementType> = {
  land: Globe2, terminator: Contrast, tropics: Orbit, meridians: Route,
  equatorialGrid: Radar, mansions: Sparkles, ecliptic: CircleDot,
  stars: Star, planets: Disc, labels: Tag, observerMarker: MapPinned,
  gridFull: Grid3x3, timeZones: Clock3, observerDome: Telescope, aurora: Sparkles,
};

const SURFACE_KEYS: (keyof LayerToggles)[] = ['land', 'terminator'];
const LINE_KEYS: (keyof LayerToggles)[] = ['tropics', 'meridians', 'gridFull', 'equatorialGrid', 'ecliptic'];
const GROUND_KEYS = [...SURFACE_KEYS, ...LINE_KEYS, 'timeZones'] as (keyof LayerToggles)[];
const SKY_KEYS: (keyof LayerToggles)[] = ['stars', 'planets'];

// عين الراصد: أوامر النظر والإسقاطات (الحالة في state/eye؛ الزمن والطبقات من المتجر الرئيسي)
const EYE_LOOKS: [LookKind, TKey][] = [
  ['sun', 'eye_sun'], ['moon', 'eye_moon'], ['north', 'eye_dir_n'], ['east', 'eye_dir_e'],
  ['south', 'eye_dir_s'], ['west', 'eye_dir_w'], ['zenith', 'eye_look_zenith'], ['dial', 'eye_look_dial'],
];
const EYE_PROJECTIONS: ProjectionKind[] = ['stereographic', 'perspective', 'equidistant'];

const JUMP_PHASES = [0, 90, 180, 270] as const; // محاق، تربيع أول، بدر، تربيع أخير

type PopoverKey = 'eye' | 'time' | 'observer' | 'ground' | 'sky' | 'zodiac' | 'mansions' | 'settings' | null;
type DateField = 'year' | 'month' | 'day' | 'hour' | 'minute';

function addToDateField(date: Date, field: DateField, delta: number): Date {
  const d = new Date(date);
  if (field === 'year') d.setFullYear(d.getFullYear() + delta);
  else if (field === 'month') d.setMonth(d.getMonth() + delta);
  else if (field === 'day') d.setDate(d.getDate() + delta);
  else if (field === 'hour') d.setHours(d.getHours() + delta);
  else d.setMinutes(d.getMinutes() + delta);
  return d;
}

/* ------------------------------------------------------------------ */
/*  مكوّنات صغيرة مشتركة                                                */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  اللوحة                                                              */
/* ------------------------------------------------------------------ */
function ControlsPanelImpl() {
  const { t, lang, locale, setLang, speedLabel } = useI18n();
  const settings = useSettings();
  const [openPopover, setOpenPopover] = useState<PopoverKey>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<'gregorian' | 'hijri'>('gregorian');
  const [geoStatus, setGeoStatus] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [mansionFilter, setMansionFilter] = useState('');

  const date = useSimDate(200);
  const cur = () => useSimulationStore.getState().date;
  const {
    isPlaying, speedIndex, observer, layers, timeZoneKind, selectedZodiacs, selectedMansionIndices, setDate, togglePlay, resetToNow, setSpeedIndex, setObserver, toggleLayer, toggleZodiacSelection, clearZodiacSelection, toggleMansionSelection, clearMansionSelection, setTimeZoneKind, auroraKp, setAuroraKp,
  } = useSimulationStore(
    useShallow((s) => ({ isPlaying: s.isPlaying, speedIndex: s.speedIndex, observer: s.observer, layers: s.layers, timeZoneKind: s.timeZoneKind, selectedZodiacs: s.selectedZodiacs, selectedMansionIndices: s.selectedMansionIndices, setDate: s.setDate, togglePlay: s.togglePlay, resetToNow: s.resetToNow, setSpeedIndex: s.setSpeedIndex, setObserver: s.setObserver, toggleLayer: s.toggleLayer, toggleZodiacSelection: s.toggleZodiacSelection, clearZodiacSelection: s.clearZodiacSelection, toggleMansionSelection: s.toggleMansionSelection, clearMansionSelection: s.clearMansionSelection, setTimeZoneKind: s.setTimeZoneKind, auroraKp: s.auroraKp, setAuroraKp: s.setAuroraKp })),
  );

  const eye = useEyeStore(useShallow((s) => ({ open: s.open, projection: s.projection, ground: s.ground, sundial: s.sundial, altAzGrid: s.altAzGrid, fovDeg: s.fovDeg, track: s.track, solarFilter: s.solarFilter, immersive: s.immersive })));
  const trackZodiacs = useSimulationStore((s) => s.selectedZodiacs);
  const trackStar = useSimulationStore((s) => s.highlightedStarId);
  const trackIs = (k: string, extra?: string) => !!eye.track && eye.track.kind === k && (extra === undefined || ('name' in eye.track ? eye.track.name === extra : 'key' in eye.track ? eye.track.key === extra : true));
  const [fovLo, fovHi] = fovLimits(eye.projection);

  const closeAll = () => { setOpenPopover(null); };

  // ؟ أو F1: تفتح صفحة الإعدادات عند إرشادات الاختصارات
  useEffect(() => {
    const open = () => { setDrawerOpen(true); setOpenPopover('settings'); };
    window.addEventListener(OPEN_SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, open);
  }, []);

  // Escape: يغلق النافذة المنبثقة أولاً، ثم الدرج
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openPopover) setOpenPopover(null);
      else closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPopover]);

  const toggle = (key: PopoverKey) => setOpenPopover((prev) => (prev === key ? null : key));
  const closeDrawer = () => { setDrawerOpen(false); setOpenPopover(null); };

  const hijriFmt = (d: Date) => {
    try {
      return new Intl.DateTimeFormat(locale.hijri, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
    } catch {
      return '—';
    }
  };

  const mansions = getAllLunarMansions();
  const q = mansionFilter.trim().toLowerCase();
  const filteredMansions = mansions.filter(
    (m) => !q || m.nameAr.includes(q) || mansionName(m, 'en').toLowerCase().includes(q),
  );

  const groundOn = GROUND_KEYS.filter((k) => layers[k]).length;
  const skyOn = SKY_KEYS.filter((k) => layers[k]).length;
  const latHint = `${Math.abs(observer.latitudeDeg).toFixed(2)}°${observer.latitudeDeg >= 0 ? t('dir_n') : t('dir_s')}`;
  const lonHint = `${Math.abs(observer.longitudeDeg).toFixed(2)}°${observer.longitudeDeg >= 0 ? t('dir_e') : t('dir_w')}`;
  const lonLatHint = settings.coordFormat === 'decimal'
    ? `${latHint} · ${lonHint}`
    : `${formatCoord(observer.latitudeDeg, t('dir_n'), t('dir_s'), 'dms')} · ${formatCoord(observer.longitudeDeg, t('dir_e'), t('dir_w'), 'dms')}`;

  const locate = () => {
    if (!navigator.geolocation) return setGeoStatus('failed');
    setGeoStatus('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setObserver({ latitudeDeg: pos.coords.latitude, longitudeDeg: pos.coords.longitude });
        setGeoStatus('idle');
      },
      () => setGeoStatus('failed'),
      { timeout: 10_000 },
    );
  };

  const layerRow = (k: keyof LayerToggles) => (
    <SwitchRow key={k} icon={LAYER_ICONS[k]} label={t(`layer_${k}` as TKey)} checked={layers[k]} onChange={() => toggleLayer(k)} />
  );

  return (
    <>
      <button className="menu-fab" data-hidden={drawerOpen} onClick={() => setDrawerOpen(true)} aria-label={t('menu_open')}>
        <Menu size={22} />
      </button>
      {drawerOpen && <button className="drawer-backdrop" onClick={closeDrawer} aria-label={t('menu_close')} />}

      <nav className="controls-panel" data-open={drawerOpen} aria-label={t('nav_aria')}>
        <div className="sidebar-brand">
          <Moon size={20} />
          <span className="brand-name">{t('app_name')}</span>
          <button className="drawer-close" onClick={closeDrawer} aria-label={t('menu_close')}>
            <X size={18} />
          </button>
        </div>

        <div className="icon-bar">
          {/* ===== الساعة وأزرار التشغيل ===== */}
          <div className="transport">
            <button
              className="play-btn"
              data-active={isPlaying}
              onClick={togglePlay}
              aria-label={t(isPlaying ? 'pause' : 'play')}
              title={t(isPlaying ? 'pause' : 'play')}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button className="clock" data-active={openPopover === 'time'} onClick={() => toggle('time')} aria-label={t('nav_time')}>
              <span className="clock-time num">{fmtClock(date, settings.hour12)}</span>
              <span className="clock-date">
                {fmtDateLong(date, locale.date)}
                <span className="clock-speed">{speedLabel(SPEED_LABELS_AR, speedIndex)}</span>
              </span>
            </button>

            {openPopover === 'time' && (
              <Flyout icon={Clock} title={t('nav_time')} onClose={closeAll}>
                <Section title={t('time_direct')}>
                  <input
                    type="datetime-local"
                    step={1}
                    className="coord-input dt-input"
                    value={toInputValue(date)}
                    onFocus={() => { if (isPlaying) togglePlay(); }}
                    onChange={(e) => {
                      const d = new Date(e.target.value);
                      if (!Number.isNaN(d.getTime())) setDate(d);
                    }}
                  />
                </Section>

                <div className="calendar-toggle" role="group">
                  <button aria-pressed={calendarMode === 'gregorian'} onClick={() => setCalendarMode('gregorian')}>{t('cal_gregorian')}</button>
                  <button aria-pressed={calendarMode === 'hijri'} onClick={() => setCalendarMode('hijri')}>{t('cal_hijri')}</button>
                </div>

                {calendarMode === 'gregorian' ? (
                  <>
                    <StepperRow label={t('f_year')} value={String(date.getFullYear())}
                      onDec={() => setDate(addToDateField(cur(), 'year', -1))} onInc={() => setDate(addToDateField(cur(), 'year', 1))} />
                    <StepperRow label={t('f_month')} value={monthName(date, locale.date)}
                      onDec={() => setDate(addToDateField(cur(), 'month', -1))} onInc={() => setDate(addToDateField(cur(), 'month', 1))} />
                    <StepperRow label={t('f_day')} value={String(date.getDate())}
                      onDec={() => setDate(addToDateField(cur(), 'day', -1))} onInc={() => setDate(addToDateField(cur(), 'day', 1))} />
                  </>
                ) : (
                  <>
                    <div className="hijri-display">{hijriFmt(date)}</div>
                    <StepperRow label={t('f_day')} value={String(date.getDate())}
                      onDec={() => setDate(addToDateField(cur(), 'day', -1))} onInc={() => setDate(addToDateField(cur(), 'day', 1))} />
                  </>
                )}
                <StepperRow label={t('f_hour')} value={String(date.getHours()).padStart(2, '0')}
                  onDec={() => setDate(addToDateField(cur(), 'hour', -1))} onInc={() => setDate(addToDateField(cur(), 'hour', 1))} />
                <StepperRow label={t('f_minute')} value={String(date.getMinutes()).padStart(2, '0')}
                  onDec={() => setDate(addToDateField(cur(), 'minute', -1))} onInc={() => setDate(addToDateField(cur(), 'minute', 1))} />

                <button className="btn-wide" onClick={resetToNow}><RotateCcw size={16} /> {t('now')}</button>

                <Section title={t('jump_title')}>
                  <div className="chip-row">
                    {JUMP_PHASES.map((deg) => (
                      <button key={deg} className="chip-btn" onClick={() => setDate(findPhase(cur(), deg))}>
                        {t(`phase_${deg / 45}` as TKey)}
                      </button>
                    ))}
                  </div>
                </Section>

                <div className="speed-row">
                  <span className="speed-label">{t('speed')}</span>
                  <input
                    type="range" min={0} max={6} step={1} value={speedIndex}
                    onChange={(e) => setSpeedIndex(Number(e.target.value))}
                    className="slider"
                    style={{ '--p': `${(speedIndex / 6) * 100}%` } as CSSProperties}
                  />
                  <span className="speed-chip">{speedLabel(SPEED_LABELS_AR, speedIndex)}</span>
                </div>
              </Flyout>
            )}
          </div>

          {/* ===== البحث والأحداث (مكوّنان قائمان — يُعاد تنسيقهما عبر CSS) ===== */}
          <div className="icon-group">
            <span className="sidebar-section-label">{t('grp_search')}</span>
            <StarSearchBar />
            <EclipsePanel />
          </div>

          {/* ===== الوقت والموقع ===== */}
          <div className="icon-group">
            <span className="sidebar-section-label">{t('grp_time')}</span>

            <div className="icon-item">
              <NavRow icon={MapPinned} title={t('nav_observer')} hint={lonLatHint}
                active={openPopover === 'observer'} onClick={() => toggle('observer')} />
              {openPopover === 'observer' && (
                <Flyout icon={MapPinned} title={t('nav_observer')} onClose={closeAll}>
                  <div className="coord-grid">
                    <CoordField label={t('lat')} value={observer.latitudeDeg} min={-90} max={90}
                      pos={t('dir_n')} neg={t('dir_s')} onCommit={(n) => setObserver({ latitudeDeg: n })} />
                    <CoordField label={t('lon')} value={observer.longitudeDeg} min={-180} max={180}
                      pos={t('dir_e')} neg={t('dir_w')} onCommit={(n) => setObserver({ longitudeDeg: n })} />
                  </div>

                  <button className="btn-wide" onClick={locate} disabled={geoStatus === 'busy'}>
                    <LocateFixed size={16} /> {geoStatus === 'busy' ? t('locating') : t('use_my_location')}
                  </button>
                  {geoStatus === 'failed' && <p className="form-error" role="alert">{t('geo_failed')}</p>}

                  <Section title={t('presets')}>
                    <div className="chip-row">
                      {CITIES.map((c) => (
                        <button key={c.id} className="chip-btn" onClick={() => setObserver({ latitudeDeg: c.lat, longitudeDeg: c.lon })}>
                          {t(c.id as TKey)}
                        </button>
                      ))}
                    </div>
                  </Section>

                  <SwitchRow icon={MapPinned} label={t('show_marker')} checked={layers.observerMarker} onChange={() => toggleLayer('observerMarker')} />
                  <SwitchRow icon={Telescope} label={t('dome_toggle')} checked={layers.observerDome} onChange={() => toggleLayer('observerDome')} />
                  <SwitchRow icon={Sparkles} label={t('layer_aurora')} checked={layers.aurora} onChange={() => toggleLayer('aurora')} />
                  {layers.aurora && (
                    <div className="speed-row">
                      <span className="speed-label">{t('aurora_kp')}</span>
                      <input
                        type="range" min={0} max={9} step={0.5} value={auroraKp}
                        onChange={(e) => setAuroraKp(Number(e.target.value))}
                        className="slider"
                        style={{ '--p': `${(auroraKp / 9) * 100}%` } as CSSProperties}
                      />
                      <span className="speed-chip num">{auroraKp}</span>
                    </div>
                  )}
                </Flyout>
              )}
            </div>

            <div className="icon-item">
              <NavRow icon={Telescope} title={t('nav_dome')} hint={t(layers.observerDome ? 'hint_on' : 'hint_off')}
                switchState={layers.observerDome} onClick={() => toggleLayer('observerDome')} />
            </div>

            <div className="icon-item">
              <NavRow icon={Eye} title={t('nav_eye')} hint={t(eye.open ? 'hint_on' : 'nav_eye_hint')} badge={eye.open}
                active={openPopover === 'eye'} onClick={() => { if (!eye.open) useEyeStore.getState().setOpen(true); toggle('eye'); }} />
              {openPopover === 'eye' && (
                <Flyout icon={Eye} title={t('nav_eye')} onClose={closeAll}>
                  <SwitchRow icon={Eye} label={t('eye_view_on')} checked={eye.open} onChange={() => useEyeStore.getState().setOpen(!eye.open)} />
                  {eye.open && (
                    <>
                      <Section title={t('eye_look')}>
                        <div className="eye-chips">
                          {EYE_LOOKS.map(([k, label]) => (
                            <button key={k} className="eye-btn" onClick={() => useEyeStore.getState().look(k)}>{t(label)}</button>
                          ))}
                        </div>
                      </Section>
                      <Section title={t('eye_track')}>
                        <div className="eye-chips">
                          <button className="eye-btn" data-on={!eye.track} onClick={() => useEyeStore.getState().setTrack(null)}>{t('eye_track_none')}</button>
                          <button className="eye-btn" data-on={trackIs('sun')} onClick={() => useEyeStore.getState().setTrack({ kind: 'sun' })}>{t('eye_sun')}</button>
                          <button className="eye-btn" data-on={trackIs('moon')} onClick={() => useEyeStore.getState().setTrack({ kind: 'moon' })}>{t('eye_moon')}</button>
                          {PLANET_NAMES.map((n) => (
                            <button key={n} className="eye-btn" data-on={trackIs('planet', n)} onClick={() => useEyeStore.getState().setTrack({ kind: 'planet', name: n })}>{lang === 'ar' ? PLANET_LABELS_AR[n] : n}</button>
                          ))}
                          {trackZodiacs.map((z) => (
                            <button key={String(z)} className="eye-btn" data-on={trackIs('zodiac', String(z))} onClick={() => useEyeStore.getState().setTrack({ kind: 'zodiac', key: String(z) })}>
                              {zodiacName(String(z), getZodiacNameAr(z, Math.max(0, ZODIAC_ORDER.indexOf(z))), lang)}
                            </button>
                          ))}
                          {trackStar !== null && <button className="eye-btn" data-on={trackIs('star')} onClick={() => useEyeStore.getState().setTrack({ kind: 'star' })}>{t('eye_track_star')}</button>}
                        </div>
                      </Section>
                      <Section title={t('eye_projection')}>
                        <Segmented<ProjectionKind> label={t('eye_projection')} value={eye.projection} onChange={(p) => useEyeStore.getState().setProjection(p)}
                          options={EYE_PROJECTIONS.map((p) => ({ value: p, label: t(`eye_proj_${p}` as TKey) }))} />
                      </Section>
                      <Section title={`${t('eye_fov')} · ${eye.fovDeg.toFixed(eye.fovDeg < 10 ? 2 : 1)}°`}>
                        <input type="range" className="eye-range" min={0} max={1000} aria-label={t('eye_fov')}
                          value={Math.round((Math.log(eye.fovDeg / fovLo) / Math.log(fovHi / fovLo)) * 1000)}
                          onChange={(e: { target: { value: string } }) => useEyeStore.getState().setFov(fovLo * Math.pow(fovHi / fovLo, Number(e.target.value) / 1000))} />
                      </Section>
                      <Section title={t('eye_layers')}>
                        <SwitchRow icon={Globe2} label={t('eye_opt_ground')} checked={eye.ground} onChange={() => useEyeStore.getState().toggle('ground')} />
                        <SwitchRow icon={Clock} label={t('eye_opt_sundial')} checked={eye.sundial} onChange={() => useEyeStore.getState().toggle('sundial')} />
                        <SwitchRow icon={Grid3x3} label={t('eye_opt_grid')} checked={eye.altAzGrid} onChange={() => useEyeStore.getState().toggle('altAzGrid')} />
                        <SwitchRow icon={Sun} label={t('eye_filter')} checked={eye.solarFilter} onChange={() => useEyeStore.getState().setSolarFilter(!eye.solarFilter)} />
                        {eye.solarFilter && <p className="sc-note">{t('eye_filter_note')}</p>}
                        <SwitchRow icon={Maximize} label={t('eye_immersive')} checked={eye.immersive} onChange={() => useEyeStore.getState().setImmersive(!eye.immersive)} />
                      </Section>
                    </>
                  )}
                </Flyout>
              )}
            </div>
          </div>

          {/* ===== طبقات العرض ===== */}
          <div className="icon-group">
            <span className="sidebar-section-label">{t('grp_layers')}</span>

            <div className="icon-item">
              <NavRow icon={Globe2} title={t('nav_ground')}
                hint={groundOn ? t('hint_layers_on', { n: groundOn }) : t('hint_none')}
                active={openPopover === 'ground'} badge={groundOn > 0} onClick={() => toggle('ground')} />
              {openPopover === 'ground' && (
                <Flyout icon={Globe2} title={t('nav_ground')} onClose={closeAll}>
                  <Section title={t('sec_surface')}>{SURFACE_KEYS.map(layerRow)}</Section>
                  <Section title={t('sec_lines')}>{LINE_KEYS.map(layerRow)}</Section>
                  <Section title={t('sec_tz')}>
                    {layerRow('timeZones')}
                    {layers.timeZones && (
                      <div className="calendar-toggle" role="group" aria-label={t('tz_aria')}>
                        <button aria-pressed={timeZoneKind === 'nominal'} onClick={() => setTimeZoneKind('nominal')}>{t('tz_nominal')}</button>
                        <button aria-pressed={timeZoneKind === 'legal'} onClick={() => setTimeZoneKind('legal')}>{t('tz_legal')}</button>
                      </div>
                    )}
                  </Section>
                </Flyout>
              )}
            </div>

            <div className="icon-item">
              <NavRow icon={Star} title={t('nav_sky')}
                hint={skyOn ? t('hint_layers_on', { n: skyOn }) : t('hint_none')}
                active={openPopover === 'sky'} badge={skyOn > 0} onClick={() => toggle('sky')} />
              {openPopover === 'sky' && (
                <Flyout icon={Star} title={t('nav_sky')} onClose={closeAll}>
                  <Section title={t('sec_objects')}>{SKY_KEYS.map(layerRow)}</Section>
                </Flyout>
              )}
            </div>

          </div>

          {/* ===== الإبرازات ===== */}
          <div className="icon-group">
            <span className="sidebar-section-label">{t('grp_highlight')}</span>

            <div className="icon-item">
              <NavRow icon={Compass} title={t('nav_zodiac')}
                hint={selectedZodiacs.length ? t('hint_selected', { n: selectedZodiacs.length }) : t('hint_none')}
                active={openPopover === 'zodiac'} badge={selectedZodiacs.length > 0} onClick={() => toggle('zodiac')} />
              {openPopover === 'zodiac' && (
                <Flyout icon={Compass} title={t('nav_zodiac')} onClose={closeAll}>
                  <div className="list-actions">
                    <button className="clear-btn" onClick={() => ZODIAC_ORDER.forEach((z: ZodiacKey) => { if (!selectedZodiacs.includes(z)) toggleZodiacSelection(z); })}>
                      {t('select_all')}
                    </button>
                    {selectedZodiacs.length > 0 && (
                      <button className="clear-btn" onClick={clearZodiacSelection}>{t('clear_sel', { n: selectedZodiacs.length })}</button>
                    )}
                  </div>
                  <div className="select-list">
                    {ZODIAC_ORDER.map((z: ZodiacKey, i: number) => (
                      <button key={z} className="select-item" aria-pressed={selectedZodiacs.includes(z)} onClick={() => toggleZodiacSelection(z)}>
                        <span className="select-index num">{i + 1}</span>
                        <span className="select-name">{zodiacName(String(z), getZodiacNameAr(z, i), lang)}</span>
                      </button>
                    ))}
                  </div>
                </Flyout>
              )}
            </div>

            <div className="icon-item">
              <NavRow icon={Sparkles} title={t('nav_mansions')}
                hint={selectedMansionIndices.length ? t('hint_selected', { n: selectedMansionIndices.length }) : layers.mansions ? t('hint_on') : t('hint_none')}
                active={openPopover === 'mansions'} badge={selectedMansionIndices.length > 0 || layers.mansions}
                onClick={() => toggle('mansions')} />
              {openPopover === 'mansions' && (
                <Flyout icon={Sparkles} title={t('nav_mansions')} onClose={closeAll}>
                  <SwitchRow icon={Sparkles} label={t('mansions_show_all')} checked={layers.mansions} onChange={() => toggleLayer('mansions')} />
                  <input
                    className="search-input" type="search" value={mansionFilter}
                    onChange={(e) => setMansionFilter(e.target.value)} placeholder={t('filter_ph')}
                  />
                  {selectedMansionIndices.length > 0 && (
                    <div className="list-actions">
                      <button className="clear-btn" onClick={clearMansionSelection}>{t('clear_sel', { n: selectedMansionIndices.length })}</button>
                    </div>
                  )}
                  <div className="select-list select-list-scroll">
                    {filteredMansions.map((m) => (
                      <button key={m.index} className="select-item" aria-pressed={selectedMansionIndices.includes(m.index)} onClick={() => toggleMansionSelection(m.index)}>
                        <span className="select-index num">{m.index + 1}</span>
                        <span className="select-name">{mansionName(m, lang)}</span>
                      </button>
                    ))}
                    {filteredMansions.length === 0 && <div className="search-empty">{t('no_results')}</div>}
                  </div>
                </Flyout>
              )}
            </div>
          </div>
        </div>
        <div className="sidebar-footer">
          <NavRow icon={SettingsIcon} title={t('nav_settings')} active={openPopover === 'settings'} onClick={() => toggle('settings')} />
          {openPopover === 'settings' && (
            <Flyout icon={SettingsIcon} title={t('nav_settings')} onClose={closeAll}>
              <Section title={t('set_language')}>
                <Segmented<'ar' | 'en'> label={t('set_language')} value={lang} onChange={setLang}
                  options={[{ value: 'ar', label: t('set_lang_ar') }, { value: 'en', label: t('set_lang_en') }]} />
              </Section>
              <Section title={t('set_display')}>
                <SwitchRow icon={Tag} label={t('set_labels')} checked={layers.labels} onChange={() => toggleLayer('labels')} />
                <SwitchRow icon={Info} label={t('set_info_card')} checked={settings.showInfoCard} onChange={() => updateSettings({ showInfoCard: !settings.showInfoCard })} />
              </Section>
              <LookPicker />
              <Section title={t('set_time_format')}>
                <Segmented<'24' | '12'> label={t('set_time_format')} value={settings.hour12 ? '12' : '24'}
                  onChange={(v) => updateSettings({ hour12: v === '12' })}
                  options={[{ value: '24', label: t('set_24h') }, { value: '12', label: t('set_12h') }]} />
              </Section>
              <Section title={t('set_coords')}>
                <Segmented<'decimal' | 'dms'> label={t('set_coords')} value={settings.coordFormat}
                  onChange={(v) => updateSettings({ coordFormat: v })}
                  options={[{ value: 'decimal', label: t('set_decimal') }, { value: 'dms', label: t('set_dms') }]} />
              </Section>
              <Section title={t('set_shortcuts')}>
                <ShortcutsGuide />
              </Section>
              <button className="btn-wide" onClick={resetSettings}><RotateCcw size={16} /> {t('set_reset')}</button>
            </Flyout>
          )}
        </div>
      </nav>
    </>
  );
}

/** بلا خصائص: يمنع إعادة رسم اللوحة كلما أعاد App رسم نفسه */
export const ControlsPanel = memo(ControlsPanelImpl);
