import { useState, type CSSProperties, type ElementType } from 'react';
import {
  Play, Pause, RotateCcw, LocateFixed, MapPinned, Layers, Compass,
  Globe2, Contrast, Orbit, Route, Radar, Sparkles, CircleDot, Star, Disc, Tag, X, ChevronDown,
} from 'lucide-react';
import { SPEED_LABELS_AR, useSimulationStore, type LayerToggles } from '../state/store';
import { ZODIAC_ORDER, ZODIAC_SYMBOLS, type ZodiacKey } from '../core/zodiac';

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const LAYER_ICONS: Record<keyof LayerToggles, ElementType> = {
  land: Globe2,
  terminator: Contrast,
  tropics: Orbit,
  meridians: Route,
  equatorialGrid: Radar,
  mansions: Sparkles,
  ecliptic: CircleDot,
  stars: Star,
  planets: Disc,
  labels: Tag,
  observerMarker: MapPinned,
};

const LAYER_TITLES: Record<keyof LayerToggles, string> = {
  land: 'الأرض',
  terminator: 'الليل والنهار',
  tropics: 'المدارات الثلاثة',
  meridians: 'خطوط الطول',
  equatorialGrid: 'الشبكة الاستوائية',
  mansions: 'منازل القمر',
  ecliptic: 'خط البروج',
  stars: 'النجوم',
  planets: 'الكواكب',
  labels: 'الأسماء',
  observerMarker: 'موقعي',
};

const LAYER_CAPTIONS: Record<keyof LayerToggles, string> = {
  land: 'أرض',
  terminator: 'ليل',
  tropics: 'مدارات',
  meridians: 'طول',
  equatorialGrid: 'شبكة',
  mansions: 'منازل',
  ecliptic: 'بروج',
  stars: 'نجوم',
  planets: 'كواكب',
  labels: 'أسماء',
  observerMarker: 'موقعي',
};

const MAIN_LAYER_KEYS: (keyof LayerToggles)[] = [
  'land', 'terminator', 'tropics', 'meridians', 'equatorialGrid',
  'ecliptic', 'mansions', 'stars', 'planets', 'labels', 'observerMarker',
];

type SectionKey = 'observer' | 'layers' | 'zodiac';

const SECTIONS: { key: SectionKey; title: string; icon: ElementType }[] = [
  { key: 'observer', title: 'موقع المراقب', icon: MapPinned },
  { key: 'layers', title: 'طبقات السماء', icon: Layers },
  { key: 'zodiac', title: 'عزل الأبراج', icon: Compass },
];

export function ControlsPanel() {
  // كل قسم يُفتح ويُغلق باستقلالية — أكورديون واحد، بلا تمييز بين الجوال والحاسوب
  const [open, setOpen] = useState<Set<SectionKey>>(new Set());

  const {
    date, isPlaying, speedIndex, observer, layers, isolatedZodiac,
    setDate, togglePlay, resetToNow, setSpeedIndex, setObserver,
    toggleLayer, setIsolatedZodiac,
  } = useSimulationStore();

  function toggleSection(key: SectionKey) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const speedPercent = (speedIndex / 6) * 100;

  return (
    <nav className="controls-panel" aria-label="لوحة تحكم المحاكي">
      <div className="brand">
        <span className="brand-mark"><Orbit size={20} /></span>
        <div>
          <div className="brand-title">نجم</div>
          <div className="brand-sub">مِرصاد يقين الفلكي</div>
        </div>
      </div>

      {/* الشريط الأساسي: يبقى ظاهراً دائماً */}
      <div className="cp-primary">
        <button
          className="btn-icon btn-play"
          onClick={togglePlay}
          title={isPlaying ? 'إيقاف' : 'تشغيل'}
          aria-pressed={isPlaying}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <input
          type="datetime-local"
          className="datetime"
          value={toLocalInputValue(date)}
          onChange={(e) => e.target.value && setDate(new Date(e.target.value))}
          aria-label="التاريخ والوقت"
        />
        <button className="btn-icon" onClick={resetToNow} title="الوقت الحالي">
          <RotateCcw size={17} />
        </button>
      </div>

      <div className="speed-row">
        <span className="speed-label">السرعة</span>
        <input
          type="range"
          min={0}
          max={6}
          step={1}
          value={speedIndex}
          onChange={(e) => setSpeedIndex(Number(e.target.value))}
          className="slider"
          style={{ '--p': `${speedPercent}%` } as CSSProperties}
          aria-label="سرعة تسارع الزمن"
        />
        <span className="speed-chip">{SPEED_LABELS_AR[speedIndex]}</span>
      </div>

      {/* الأقسام الثانوية: تُفتح حسب رغبة المستخدم */}
      <div className="acc">
        {SECTIONS.map(({ key, title, icon: Icon }) => {
          const isOpen = open.has(key);
          return (
            <div className="acc-item" data-open={isOpen} key={key}>
              <button className="acc-head" onClick={() => toggleSection(key)} aria-expanded={isOpen}>
                <Icon size={17} />
                <span className="acc-title">{title}</span>
                <ChevronDown size={16} className="chev" />
              </button>

              <div className="acc-body">
                <div className="acc-clip">
                  <div className="acc-content">
                    {key === 'observer' && (
                      <div className="field-group">
                        <div className="coord-grid">
                          <div className="field">
                            <span className="field-label">خط العرض</span>
                            <input
                              type="number"
                              step={0.01}
                              value={observer.latitudeDeg}
                              onChange={(e) => setObserver({ latitudeDeg: Number(e.target.value) })}
                              className="coord-input"
                            />
                          </div>
                          <div className="field">
                            <span className="field-label">خط الطول</span>
                            <input
                              type="number"
                              step={0.01}
                              value={observer.longitudeDeg}
                              onChange={(e) => setObserver({ longitudeDeg: Number(e.target.value) })}
                              className="coord-input"
                            />
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
                          <LocateFixed size={16} />
                          استخدام موقعي الحالي
                        </button>
                      </div>
                    )}

                    {key === 'layers' && (
                      <div className="layers-grid">
                        {MAIN_LAYER_KEYS.map((k) => {
                          const LayerIcon = LAYER_ICONS[k];
                          return (
                            <button
                              key={k}
                              className="layer-tile"
                              aria-pressed={layers[k]}
                              title={LAYER_TITLES[k]}
                              onClick={() => toggleLayer(k)}
                            >
                              <LayerIcon size={17} />
                              <span>{LAYER_CAPTIONS[k]}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {key === 'zodiac' && (
                      <div className="field-group">
                        {isolatedZodiac && (
                          <button className="btn-wide subtle" onClick={() => setIsolatedZodiac(null)}>
                            <X size={14} />
                            إلغاء عزل {isolatedZodiac}
                          </button>
                        )}
                        <div className="zodiac-grid">
                          {ZODIAC_ORDER.map((z: ZodiacKey) => (
                            <button
                              key={z}
                              className="zodiac-btn"
                              aria-pressed={isolatedZodiac === z}
                              title={z}
                              onClick={() => setIsolatedZodiac(isolatedZodiac === z ? null : z)}
                            >
                              {ZODIAC_SYMBOLS[z]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}