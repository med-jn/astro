import { useState, type CSSProperties, type ElementType } from 'react';
import {
  Play, Pause, Clock, MapPinned, LocateFixed, Globe2, Contrast, Orbit, Route, Radar,
  CircleDot, Star, Disc, Tag, Compass, Sparkles, X, Plus, Minus, RotateCcw,
} from 'lucide-react';
import { SPEED_LABELS_AR, useSimulationStore, type LayerToggles } from '../state/store';
import { ZODIAC_ORDER, type ZodiacKey } from '../core/zodiac';
import { getAllLunarMansions } from '../core/mansions';

const ZODIAC_NAMES_AR: Record<string, string> = {
  Aries: 'الحمل', Taurus: 'الثور', Gemini: 'الجوزاء', Cancer: 'السرطان',
  Leo: 'الأسد', Virgo: 'العذراء', Libra: 'الميزان', Scorpius: 'العقرب',
  Sagittarius: 'القوس', Capricornus: 'الجدي', Aquarius: 'الدلو', Pisces: 'الحيتان',
};

const GREGORIAN_MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function addToDateField(date: Date, field: 'year' | 'month' | 'day' | 'hour' | 'minute', delta: number): Date {
  const d = new Date(date);
  if (field === 'year') d.setFullYear(d.getFullYear() + delta);
  else if (field === 'month') d.setMonth(d.getMonth() + delta);
  else if (field === 'day') d.setDate(d.getDate() + delta);
  else if (field === 'hour') d.setHours(d.getHours() + delta);
  else d.setMinutes(d.getMinutes() + delta);
  return d;
}

function formatHijri(date: Date): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(date);
  } catch {
    return '—';
  }
}

const LAYER_ICONS: Record<keyof LayerToggles, ElementType> = {
  land: Globe2, terminator: Contrast, tropics: Orbit, meridians: Route,
  equatorialGrid: Radar, mansions: Sparkles, ecliptic: CircleDot,
  stars: Star, planets: Disc, labels: Tag, observerMarker: MapPinned,
};

const LAYER_TITLES: Record<keyof LayerToggles, string> = {
  land: 'الأرض', terminator: 'ظل الليل والنهار', tropics: 'المدارات الثلاثة', meridians: 'خطوط الطول',
  equatorialGrid: 'الشبكة الاستوائية', mansions: 'منازل القمر', ecliptic: 'خط البروج',
  stars: 'النجوم', planets: 'الكواكب', labels: 'الأسماء', observerMarker: 'موقعي',
};

const LAYER_CAPTIONS: Record<keyof LayerToggles, string> = {
  land: 'أرض', terminator: 'ظل', tropics: 'مدارات', meridians: 'طول',
  equatorialGrid: 'شبكة', mansions: 'منازل', ecliptic: 'بروج',
  stars: 'نجوم', planets: 'كواكب', labels: 'أسماء', observerMarker: 'موقعي',
};

const GROUND_KEYS: (keyof LayerToggles)[] = ['land', 'terminator', 'tropics', 'meridians', 'equatorialGrid', 'ecliptic'];
const SKY_KEYS: (keyof LayerToggles)[] = ['stars', 'planets'];

type PopoverKey = 'time' | 'observer' | 'ground' | 'sky' | 'zodiac' | 'mansions' | null;

function StepperRow({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="stepper-row">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button className="stepper-btn" onClick={onDec} aria-label={`إنقاص ${label}`}><Minus size={14} /></button>
        <span className="stepper-value">{value}</span>
        <button className="stepper-btn" onClick={onInc} aria-label={`زيادة ${label}`}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function LayerTile({ layerKey, active, onToggle }: { layerKey: keyof LayerToggles; active: boolean; onToggle: () => void }) {
  const Icon = LAYER_ICONS[layerKey];
  return (
    <button className="layer-tile" aria-pressed={active} title={LAYER_TITLES[layerKey]} onClick={onToggle}>
      <Icon size={17} />
      <span>{LAYER_CAPTIONS[layerKey]}</span>
    </button>
  );
}

export function ControlsPanel() {
  const [openPopover, setOpenPopover] = useState<PopoverKey>(null);
  const [calendarMode, setCalendarMode] = useState<'gregorian' | 'hijri'>('gregorian');

  const {
    date, isPlaying, speedIndex, observer, layers,
    selectedZodiacs, selectedMansionIndices,
    setDate, togglePlay, resetToNow, setSpeedIndex, setObserver, toggleLayer,
    toggleZodiacSelection, clearZodiacSelection, toggleMansionSelection, clearMansionSelection,
  } = useSimulationStore();

  const toggle = (key: PopoverKey) => setOpenPopover((prev) => (prev === key ? null : key));

  const hasGroundExtra = layers.tropics || layers.meridians || layers.equatorialGrid || layers.ecliptic;
  const hasSkyExtra = layers.stars || layers.planets;
  const hasZodiacExtra = selectedZodiacs.length > 0;
  const hasMansionExtra = selectedMansionIndices.length > 0 || layers.mansions;

  const mansions = getAllLunarMansions();

  return (
    <>
      {openPopover && <button className="popover-backdrop" onClick={() => setOpenPopover(null)} aria-label="إغلاق" />}

      <nav className="controls-panel" aria-label="لوحة تحكم المحاكي">
        <div className="icon-bar">
          {/* تشغيل/إيقاف — تبديل مباشر بلا نافذة */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={isPlaying} onClick={togglePlay} title={isPlaying ? 'إيقاف' : 'تشغيل'}>
              {isPlaying ? <Pause size={19} /> : <Play size={19} />}
            </button>
          </div>

          {/* الوقت والتاريخ */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={openPopover === 'time'} onClick={() => toggle('time')} title="الوقت والتاريخ">
              <Clock size={19} />
            </button>
            {openPopover === 'time' && (
              <div className="popover-panel" role="dialog" aria-label="الوقت والتاريخ">
                <div className="popover-header">
                  <Clock size={16} />
                  <span className="popover-title-text">الوقت والتاريخ</span>
                  <button className="popover-close" onClick={() => setOpenPopover(null)}><X size={16} /></button>
                </div>
                <div className="popover-body">
                  <div className="calendar-toggle">
                    <button aria-pressed={calendarMode === 'gregorian'} onClick={() => setCalendarMode('gregorian')}>ميلادي</button>
                    <button aria-pressed={calendarMode === 'hijri'} onClick={() => setCalendarMode('hijri')}>هجري</button>
                  </div>

                  {calendarMode === 'gregorian' ? (
                    <>
                      <StepperRow label="السنة" value={String(date.getFullYear())}
                        onDec={() => setDate(addToDateField(date, 'year', -1))}
                        onInc={() => setDate(addToDateField(date, 'year', 1))} />
                      <StepperRow label="الشهر" value={GREGORIAN_MONTHS_AR[date.getMonth()]}
                        onDec={() => setDate(addToDateField(date, 'month', -1))}
                        onInc={() => setDate(addToDateField(date, 'month', 1))} />
                      <StepperRow label="اليوم" value={String(date.getDate())}
                        onDec={() => setDate(addToDateField(date, 'day', -1))}
                        onInc={() => setDate(addToDateField(date, 'day', 1))} />
                    </>
                  ) : (
                    <div className="hijri-display">{formatHijri(date)}</div>
                  )}

                  <StepperRow label="الساعة" value={String(date.getHours()).padStart(2, '0')}
                    onDec={() => setDate(addToDateField(date, 'hour', -1))}
                    onInc={() => setDate(addToDateField(date, 'hour', 1))} />
                  <StepperRow label="الدقيقة" value={String(date.getMinutes()).padStart(2, '0')}
                    onDec={() => setDate(addToDateField(date, 'minute', -1))}
                    onInc={() => setDate(addToDateField(date, 'minute', 1))} />

                  <button className="btn-wide" onClick={resetToNow}>
                    <RotateCcw size={16} /> الوقت الحالي
                  </button>

                  <div className="speed-row">
                    <span className="speed-label">السرعة</span>
                    <input
                      type="range" min={0} max={6} step={1} value={speedIndex}
                      onChange={(e) => setSpeedIndex(Number(e.target.value))}
                      className="slider"
                      style={{ '--p': `${(speedIndex / 6) * 100}%` } as CSSProperties}
                    />
                    <span className="speed-chip">{SPEED_LABELS_AR[speedIndex]}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* الموقع والإحداثيات */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={openPopover === 'observer'} onClick={() => toggle('observer')} title="الموقع والإحداثيات">
              <MapPinned size={19} />
            </button>
            {openPopover === 'observer' && (
              <div className="popover-panel" role="dialog" aria-label="الموقع والإحداثيات">
                <div className="popover-header">
                  <MapPinned size={16} />
                  <span className="popover-title-text">الموقع والإحداثيات</span>
                  <button className="popover-close" onClick={() => setOpenPopover(null)}><X size={16} /></button>
                </div>
                <div className="popover-body">
                  <div className="coord-grid">
                    <div className="field">
                      <span className="field-label">خط العرض</span>
                      <input type="number" step={0.01} value={observer.latitudeDeg}
                        onChange={(e) => setObserver({ latitudeDeg: Number(e.target.value) })} className="coord-input" />
                    </div>
                    <div className="field">
                      <span className="field-label">خط الطول</span>
                      <input type="number" step={0.01} value={observer.longitudeDeg}
                        onChange={(e) => setObserver({ longitudeDeg: Number(e.target.value) })} className="coord-input" />
                    </div>
                  </div>
                  <button
                    className="btn-wide"
                    onClick={() => {
                      if (!navigator.geolocation) return;
                      navigator.geolocation.getCurrentPosition((pos) => {
                        setObserver({ latitudeDeg: pos.coords.latitude, longitudeDeg: pos.coords.longitude });
                      });
                    }}
                  >
                    <LocateFixed size={16} /> استخدام موقعي الحالي
                  </button>
                  <button className="toggle-row" aria-pressed={layers.observerMarker} onClick={() => toggleLayer('observerMarker')}>
                    <MapPinned size={16} />
                    <span>إظهار علامة موقعي على الخريطة</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* الأرض والشبكة */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={openPopover === 'ground'} onClick={() => toggle('ground')} title="الأرض والشبكة">
              <Globe2 size={19} />
              {hasGroundExtra && <span className="badge-dot" />}
            </button>
            {openPopover === 'ground' && (
              <div className="popover-panel" role="dialog" aria-label="الأرض والشبكة">
                <div className="popover-header">
                  <Globe2 size={16} />
                  <span className="popover-title-text">الأرض والشبكة</span>
                  <button className="popover-close" onClick={() => setOpenPopover(null)}><X size={16} /></button>
                </div>
                <div className="popover-body">
                  <div className="layers-grid">
                    {GROUND_KEYS.map((k) => (
                      <LayerTile key={k} layerKey={k} active={layers[k]} onToggle={() => toggleLayer(k)} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* النجوم والكواكب */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={openPopover === 'sky'} onClick={() => toggle('sky')} title="النجوم والكواكب">
              <Star size={19} />
              {hasSkyExtra && <span className="badge-dot" />}
            </button>
            {openPopover === 'sky' && (
              <div className="popover-panel" role="dialog" aria-label="النجوم والكواكب">
                <div className="popover-header">
                  <Star size={16} />
                  <span className="popover-title-text">النجوم والكواكب</span>
                  <button className="popover-close" onClick={() => setOpenPopover(null)}><X size={16} /></button>
                </div>
                <div className="popover-body">
                  <div className="layers-grid">
                    {SKY_KEYS.map((k) => (
                      <LayerTile key={k} layerKey={k} active={layers[k]} onToggle={() => toggleLayer(k)} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* الأسماء — تبديل مباشر بلا نافذة */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={layers.labels} onClick={() => toggleLayer('labels')} title="إظهار الأسماء">
              <Tag size={19} />
            </button>
          </div>

          {/* الأبراج — اختيار متعدد */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={openPopover === 'zodiac'} onClick={() => toggle('zodiac')} title="الأبراج">
              <Compass size={19} />
              {hasZodiacExtra && <span className="badge-dot" />}
            </button>
            {openPopover === 'zodiac' && (
              <div className="popover-panel" role="dialog" aria-label="الأبراج">
                <div className="popover-header">
                  <Compass size={16} />
                  <span className="popover-title-text">الأبراج</span>
                  <button className="popover-close" onClick={() => setOpenPopover(null)}><X size={16} /></button>
                </div>
                <div className="popover-body">
                  {selectedZodiacs.length > 0 && (
                    <button className="clear-btn" onClick={clearZodiacSelection}>مسح التحديد ({selectedZodiacs.length})</button>
                  )}
                  <div className="select-list">
                    {ZODIAC_ORDER.map((z: ZodiacKey) => (
                      <button key={z} className="select-item" aria-pressed={selectedZodiacs.includes(z)} onClick={() => toggleZodiacSelection(z)}>
                        {ZODIAC_NAMES_AR[z] ?? z}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* المنازل — اختيار متعدد */}
          <div className="icon-item">
            <button className="icon-trigger" data-active={openPopover === 'mansions'} onClick={() => toggle('mansions')} title="منازل القمر">
              <Sparkles size={19} />
              {hasMansionExtra && <span className="badge-dot" />}
            </button>
            {openPopover === 'mansions' && (
              <div className="popover-panel" role="dialog" aria-label="منازل القمر">
                <div className="popover-header">
                  <Sparkles size={16} />
                  <span className="popover-title-text">منازل القمر</span>
                  <button className="popover-close" onClick={() => setOpenPopover(null)}><X size={16} /></button>
                </div>
                <div className="popover-body">
                  <button className="toggle-row" aria-pressed={layers.mansions} onClick={() => toggleLayer('mansions')}>
                    <Sparkles size={16} />
                    <span>إظهار كل الأسماء على الخريطة</span>
                  </button>
                  {selectedMansionIndices.length > 0 && (
                    <button className="clear-btn" onClick={clearMansionSelection}>مسح التحديد ({selectedMansionIndices.length})</button>
                  )}
                  <div className="select-list select-list-scroll">
                    {mansions.map((m) => (
                      <button key={m.index} className="select-item" aria-pressed={selectedMansionIndices.includes(m.index)} onClick={() => toggleMansionSelection(m.index)}>
                        {m.nameAr}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
