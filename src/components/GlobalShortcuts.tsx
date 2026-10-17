import { useEffect } from 'react';
import { useSimulationStore } from '../state/store';
import { useEyeStore } from '../state/eye';

/** اختصارات التطبيق العامة (الزمن، الطبقات، عين الراصد، ملء الشاشة، الإرشادات). انظر shortcuts.ts */
export const OPEN_SHORTCUTS_EVENT = 'najm:open-shortcuts';
const HOUR_MS = 3600 * 1000, DAY_MS = 24 * HOUR_MS;

export function GlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const tg = e.target as HTMLElement | null;
      if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
      const st = useSimulationStore.getState();
      const stepMs = (dir: 1 | -1) => st.setDate(new Date(st.date.getTime() + dir * (e.shiftKey ? DAY_MS : HOUR_MS)));
      switch (e.code) {
        case 'Space':
          if (tg && /^(BUTTON|A|SUMMARY)$/.test(tg.tagName)) return; // المسافة تفعّل الزر المركَّز
          st.togglePlay(); break;
        case 'KeyN': st.resetToNow(); break;
        case 'BracketRight': st.setSpeedIndex(Math.min(6, st.speedIndex + 1)); break;
        case 'BracketLeft': st.setSpeedIndex(Math.max(0, st.speedIndex - 1)); break;
        case 'Period': stepMs(1); break;
        case 'Comma': stepMs(-1); break;
        case 'KeyE': { const es = useEyeStore.getState(); es.setOpen(!es.open); break; }
        case 'KeyD': st.toggleLayer('observerDome'); break;
        case 'KeyP': st.toggleLayer('planets'); break;
        case 'KeyL': st.toggleLayer('labels'); break;
        case 'KeyC': st.toggleLayer('ecliptic'); break;
        case 'KeyA': st.toggleLayer('aurora'); break;
        case 'KeyF':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => undefined);
          break;
        case 'Slash':
          if (!e.shiftKey) return;
          window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)); break;
        case 'F1': window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
