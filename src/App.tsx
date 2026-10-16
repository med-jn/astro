import { useCallback, useEffect, useRef, useState } from 'react';
import { SkyCanvas } from './components/SkyCanvas';
import { ControlsPanel } from './components/ControlsPanel';
import { InfoCard } from './components/InfoCard';
import { loadStarCatalog, loadArabicEnrichment } from './core/starCatalog';
import { loadZodiacData } from './core/zodiac';
import { loadZodiacSigns } from './core/zodiacNamesAr';
import { loadStarGroups } from './core/starGroups';
import type { RenderOutput } from './render/skyRenderer';

export default function App() {
  // مخرجات الرسم تصل كل إطار، لكن البطاقة لا تحتاج أكثر من ~4 تحديثات في الثانية؛
  // تحديث الحالة في كل إطار كان يعيد رسم التطبيق كله 60 مرة في الثانية.
  const [output, setOutput] = useState<RenderOutput | null>(null);
  const latest = useRef<RenderOutput | null>(null);
  const onFrame = useCallback((o: RenderOutput) => { latest.current = o; }, []);
  useEffect(() => {
    const id = setInterval(() => setOutput((prev) => (latest.current && latest.current !== prev ? latest.current : prev)), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadStarCatalog();
    loadArabicEnrichment(); // الإثراء العربي للنجوم، بالخلفية دون انتظار
    loadZodiacData();
    loadZodiacSigns(); // أسماء وحدود الأبراج الحقيقية من سوبابيز، بالخلفية أيضاً
    loadStarGroups(); // جديد — الكوكبات (groups/group_stars/group_lines) من سوبابيز
  }, []);

  return (
    <div className="app-root">
      <ControlsPanel />
      <div className="stage">
        <SkyCanvas onFrame={onFrame} />
        <InfoCard output={output} />
      </div>
    </div>
  );
}