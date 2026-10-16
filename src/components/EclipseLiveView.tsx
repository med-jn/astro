import { useEffect, useRef, useState } from 'react';
import { useSimulationStore } from '../state/store';
import { solarViewAt, lunarViewAt } from '../core/eclipses';
import { drawSolarView, drawLunarView, drawHorizonStrip } from '../render/eclipseView';
import { LOOKS, resolveLook } from '../core/danjon';
import { updateSettings, useSettings } from '../settings';
import { useI18n, type TKey } from '../i18n';
import { useSimDate } from '../hooks';
import { useMoonTexture } from './MoonView';

/** اختيار مظهر القمر أثناء الخسوف (تلقائي أو أحد المظاهر) — مشترك بين الإعدادات والمنظر الحي */
export function LookPicker() {
  const { t } = useI18n();
  const { eclipseLook } = useSettings();
  return (
    <div className="section">
      <div className="section-title">{t('look_title')}</div>
      <div className="look-row" role="radiogroup" aria-label={t('look_title')}>
        <button
          role="radio" aria-checked={eclipseLook === 'auto'} className="look-chip" data-selected={eclipseLook === 'auto'}
          onClick={() => updateSettings({ eclipseLook: 'auto' })}
        >
          <span>{t('look_auto')}</span>
        </button>
        {LOOKS.map((l) => (
          <button
            key={l.id} role="radio" aria-checked={eclipseLook === l.id} className="look-chip"
            data-selected={eclipseLook === l.id} onClick={() => updateSettings({ eclipseLook: l.id })}
          >
            <span className="look-dot" style={{ background: l.swatch }} />
            <span>{t(`look_${l.id}` as TKey)}</span>
          </button>
        ))}
      </div>
      <p className="muted small">{t('look_note')}</p>
    </div>
  );
}

const KIND_KEY = { total: 'ecl_total', annular: 'ecl_annular', partial: 'ecl_partial' } as const;

/** المنظر المحلي الحي للكسوف أو الخسوف عند الزمن الحالي للمحاكاة وموقع الراصد */
export function LiveView({ kind }: { kind: 'solar' | 'lunar' }) {
  const { t } = useI18n();
  const date = useSimDate(120);
  const observer = useSimulationStore((s) => s.observer);
  const { eclipseLook } = useSettings();
  const tick = useMoonTexture();
  const ref = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const W = 300, H = 240, SH = 84;
  const [note, setNote] = useState('');

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const obs = { latitudeDeg: observer.latitudeDeg, longitudeDeg: observer.longitudeDeg, elevationM: (observer as { elevationM?: number }).elevationM };

    if (kind === 'solar') {
      const v = solarViewAt(date, obs);
      if (v.sun.altDeg < -0.9) {
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H);
        setNote(t('ev_sun_below'));
      } else {
        drawSolarView(ctx, W, H, v);
        const k = v.phase === 'none' ? t('ev_none_now') : t(KIND_KEY[v.phase]);
        setNote(`${k} · ${t('ecl_obsc')} ${(v.obscuration * 100).toFixed(1)}% · ${t('ecl_mag_solar')} ${Math.max(0, v.magnitude).toFixed(3)} · ${t('ecl_sun_alt')} ${v.sun.altDeg.toFixed(1)}°`);
      }
    } else {
      const v = lunarViewAt(date, obs);
      const look = resolveLook(date, eclipseLook);
      if (v.moon.altDeg < -0.9) {
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H);
        setNote(t('ev_moon_below', { alt: v.moon.altDeg.toFixed(1) }));
      } else {
        drawLunarView(ctx, W, H, v, { danjonL: look.L, tint: look.tint });
        const both = v.sun.altDeg > -0.9 && v.umbralMagnitude > 0;
        setNote(
          `${t('ecl_mag_lunar')} ${Math.max(0, v.umbralMagnitude).toFixed(3)} · ${t('ecl_mag_dim')} ${Math.max(0, v.penumbralMagnitude).toFixed(3)} · ` +
          `${t('ecl_moon_alt')} ${v.moon.altDeg.toFixed(1)}°` + (both ? ` · ${t('ev_horizontal')}` : ''),
        );
      }
      const sc = stripRef.current;
      if (sc) {
        sc.width = W * dpr; sc.height = SH * dpr;
        const c2 = sc.getContext('2d')!;
        c2.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawHorizonStrip(c2, W, SH, { sun: v.sun, moon: v.moon, shadow: v.shadow, umbralMagnitude: v.umbralMagnitude });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, observer.latitudeDeg, observer.longitudeDeg, kind, tick, eclipseLook, t]);

  return (
    <div className="live-view">
      <canvas ref={ref} className="live-canvas" style={{ width: W, height: H }} />
      {kind === 'lunar' && <canvas ref={stripRef} className="live-canvas" style={{ width: W, height: SH }} />}
      {kind === 'lunar' && <LookPicker />}
      <div className="live-note">{note}</div>
    </div>
  );
}
