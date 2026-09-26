import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useSimulationStore } from '../state/store';
import { searchAll, computeCenterPanDelta, type SearchResult } from '../core/starSearch';

/** مستوى تكبير معقول لعرض الهدف بعد التوسيط — لا يُخفَّض إن كان المستخدم مكبِّراً أكثر أصلاً */
const SEARCH_ZOOM_SCALE = 2.4;

export function StarSearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const date = useSimulationStore((s) => s.date);
  const results: SearchResult[] = useMemo(() => searchAll(query, date), [query, date]);

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

    if (result.kind === 'star') {
      if (!afterZoom.layers.stars) afterZoom.toggleLayer('stars');
    } else if (result.kind === 'zodiac' && result.zodiacKey) {
      afterZoom.clearZodiacSelection();
      afterZoom.toggleZodiacSelection(result.zodiacKey);
    } else if (result.kind === 'mansion' && result.mansionIndex !== undefined) {
      afterZoom.clearMansionSelection();
      afterZoom.toggleMansionSelection(result.mansionIndex);
    } else if (result.kind === 'group' && result.groupId !== undefined) {
      afterZoom.clearGroupSelection();
      afterZoom.toggleGroupSelection(result.groupId);
    }

    setOpen(false);
    setQuery('');
  }

  return (
    <div className="icon-item">
      <button className="icon-trigger" data-active={open} onClick={() => setOpen((v) => !v)} title="البحث في السماء">
        <Search size={19} />
        <span className="icon-caption">بحث</span>
      </button>
      {open && (
        <div className="popover-panel" role="dialog" aria-label="البحث في السماء">
          <div className="popover-header">
            <Search size={16} />
            <span className="popover-title-text">البحث في السماء</span>
            <button className="popover-close" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <div className="popover-body">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن نجم أو برج أو منزلة قمرية…"
              className="search-input"
            />
            {query.trim().length > 0 && results.length === 0 && (
              <div className="search-empty">لا توجد نتائج مطابقة</div>
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
          </div>
        </div>
      )}
    </div>
  );
}