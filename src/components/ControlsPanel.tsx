import { useState, type ElementType } from 'react';
import {
  Play, Pause, RotateCcw, LocateFixed, PanelRightClose, PanelRightOpen,
  ZoomIn, ZoomOut, Globe2, Contrast, Orbit, Route, Radar, Sparkles,
  CircleDot, MapPinned, Tag, X, Star, Disc, Compass, RefreshCw,
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
  terminator: 'ظل الليل والنهار',
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

// تسمية قصيرة جداً تحت كل أيقونة، حتى تكون واضحة دون الحاجة للتحويم (خصوصاً على الموبايل)
const LAYER_CAPTIONS: Record<keyof LayerToggles, string> = {
  land: 'أرض',
  terminator: 'ظل',
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

export function ControlsPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const {
    date, isPlaying, speedIndex, zoomScale, observer, layers, isolatedZodiac,
    sceneRotationDeg,
    setDate, togglePlay, resetToNow, setSpeedIndex, setZoom, setObserver,
    toggleLayer, setIsolatedZodiac, setSceneRotation, resetSceneRotation,
  } = useSimulationStore();

  return (
    <div className={`controls-panel ${collapsed ? 'collapsed' : ''}`}>
      <button className="panel-toggle" onClick={() => setCollapsed((c) => !c)} title="لوحة التحكم">
        {collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
      </button>

      {!collapsed && (
        <div className="panel-body">
          {/* الوقت والتشغيل */}
          <div className="row">
            <input
              type="datetime-local"
              className="time-input"
              value={toLocalInputValue(date)}
              onChange={(e) => e.target.value && setDate(new Date(e.target.value))}
            />
          </div>

          <div className="row icon-row">
            <button className={`icon-btn ${isPlaying ? 'active' : ''}`} onClick={togglePlay} title="تشغيل/إيقاف">
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="icon-btn" onClick={resetToNow} title="الوقت الحالي">
              <RotateCcw size={18} />
            </button>
            <input
              type="range" min={0} max={6} step={1} value={speedIndex}
              onChange={(e) => setSpeedIndex(Number(e.target.value))}
              className="slider"
              title={SPEED_LABELS_AR[speedIndex]}
            />
            <span className="mini-label">{SPEED_LABELS_AR[speedIndex]}</span>
          </div>

          <div className="row icon-row">
            <ZoomOut size={16} className="dim-icon" />
            <input
              type="range" min={0.5} max={6} step={0.1} value={zoomScale}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="slider"
            />
            <ZoomIn size={16} className="dim-icon" />
            <span className="mini-label">{zoomScale.toFixed(1)}x</span>
          </div>

          {/* تدوير المشهد الكامل (كل الطبقات معاً) */}
          <div className="row icon-row">
            <Compass size={16} className="dim-icon" />
            <input
              type="range" min={0} max={359} step={1} value={sceneRotationDeg}
              onChange={(e) => setSceneRotation(Number(e.target.value))}
              className="slider"
              title="تدوير المشهد بالكامل"
            />
            <span className="mini-label">{Math.round(sceneRotationDeg)}°</span>
            <button className="icon-btn" onClick={resetSceneRotation} title="تصفير الدوران">
              <RefreshCw size={16} />
            </button>
          </div>

          <hr />

          {/* موقع المراقب */}
          <div className="row icon-row">
            <MapPinned size={16} className="dim-icon" />
            <input
              type="number" step={0.01} value={observer.latitudeDeg}
              onChange={(e) => setObserver({ latitudeDeg: Number(e.target.value) })}
              className="coord-input" title="خط العرض"
            />
            <input
              type="number" step={0.01} value={observer.longitudeDeg}
              onChange={(e) => setObserver({ longitudeDeg: Number(e.target.value) })}
              className="coord-input" title="خط الطول"
            />
            <button
              className="icon-btn"
              title="موقعي الحالي"
              onClick={() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition((pos) => {
                  setObserver({ latitudeDeg: pos.coords.latitude, longitudeDeg: pos.coords.longitude });
                });
              }}
            >
              <LocateFixed size={18} />
            </button>
          </div>

          <hr />

          {/* الطبقات: أيقونة + تعليق قصير جداً تحت كل زر */}
          <div className="layers-grid">
            {MAIN_LAYER_KEYS.map((key) => {
              const Icon = LAYER_ICONS[key];
              return (
                <button
                  key={key}
                  className={`icon-btn layer-btn ${layers[key] ? 'active' : ''}`}
                  title={LAYER_TITLES[key]}
                  onClick={() => toggleLayer(key)}
                >
                  <Icon size={16} />
                  <span className="layer-caption">{LAYER_CAPTIONS[key]}</span>
                </button>
              );
            })}
          </div>

          <hr />

          {/* عزل الأبراج الاثني عشر */}
          <div className="zodiac-grid">
            {ZODIAC_ORDER.map((z: ZodiacKey) => (
              <button
                key={z}
                className={`zodiac-btn ${isolatedZodiac === z ? 'active' : ''}`}
                title={z}
                onClick={() => setIsolatedZodiac(isolatedZodiac === z ? null : z)}
              >
                {ZODIAC_SYMBOLS[z]}
              </button>
            ))}
            {isolatedZodiac && (
              <button className="icon-btn" title="إلغاء العزل" onClick={() => setIsolatedZodiac(null)}>
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}