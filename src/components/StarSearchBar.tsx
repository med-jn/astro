import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useSimulationStore } from '../state/store';
import { useSimDate } from '../hooks';
import { Flyout, NavRow } from './ui';
import { useI18n } from '../i18n';
import { searchAll, computeCenterPanDelta, type SearchResult } from '../core/starSearch';

/** مستوى تكبير معقول لعرض الهدف بعد التوسيط — لا يُخفَّض إن كان المستخدم مكبِّراً أكثر أصلاً */
const SEARCH_ZOOM_SCALE = 2.4;

export function StarSearchBar() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const date = useSimDate(500);
  const results: SearchResult[] = useMemo(() => searchAll(query, date), [query, date, lang]);

  function selectResult(result: SearchResult) {
    const current = useSimulationStore.getState();
    const targetZoom = Math.max(current.zoomScale, SEARCH_ZOOM_SCALE);
    current.setZoom(targetZoom);

    // نقرأ الحالة من جديد بعد setZoom لأن zoomScale الفعلي بعد القصّ (clamp) هو ما يحدّد
    // نصف قطر القبة الحقيقي، وحساب فرق التحريك يجب أن يعتمد على القيمة النهائية
    const afterZoom = useSimulationStore.getState();
    const { panDeltaX, panDeltaY } = computeCenterPanDelta(
      result.centerRaHours,
      result.centerDecDeg,
      afterZoom.date,
      afterZoom.zoomScale,
      afterZoom.panX,
      afterZoom.panY,
      afterZoom.sceneRotationDeg,
      afterZoom.viewportWidth,
      afterZoom.viewportHeight
    );
    afterZoom.setPan(panDeltaX, panDeltaY);

    if (!afterZoom.layers.labels) afterZoom.toggleLayer('labels');

    // أي بحث جديد يستبدل التحديد السابق كلياً (كوكبة/علامة نجمة قديمة) فلا تبقى بطاقة قديمة
    if (result.kind === 'star' && result.star) {
      if (!afterZoom.layers.stars) afterZoom.toggleLayer('stars');
      // يحدّد النجمة (علامة التصويب) ويُبرز كوكبتها بخطوطها
      afterZoom.focusStar(result.star.id);
    } else if (result.kind === 'zodiac' && result.zodiacKey) {
      afterZoom.focusStar(null);
      afterZoom.clearZodiacSelection();
      afterZoom.toggleZodiacSelection(result.zodiacKey);
    } else if (result.kind === 'mansion' && result.mansionIndex !== undefined) {
      afterZoom.focusStar(null);
      afterZoom.clearMansionSelection();
      afterZoom.toggleMansionSelection(result.mansionIndex);
    } else if (result.kind === 'group' && result.groupId !== undefined) {
      afterZoom.focusStar(null);
      afterZoom.toggleGroupSelection(result.groupId);
      // نتيجة «برج وكوكبة» مدموجة: يُبرَز مدى البرج على الكسوف أيضاً
      afterZoom.clearZodiacSelection();
      if (result.zodiacKey) afterZoom.toggleZodiacSelection(result.zodiacKey);
    }

    setOpen(false);
    setQuery('');
  }

  return (
    <div className="icon-item">
      <NavRow icon={Search} title={t('search_short')} active={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <Flyout icon={Search} title={t('search_title')} onClose={() => setOpen(false)}>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search_ph')}
            className="search-input"
          />
          {query.trim().length > 0 && results.length === 0 && (
            <div className="search-empty">{t('search_none')}</div>
          )}
          {results.length > 0 && (
            <div className="select-list select-list-scroll">
              {results.map((r) => (
                <button key={r.id} className="select-item" onClick={() => selectResult(r)}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </Flyout>
      )}
    </div>
  );
}
