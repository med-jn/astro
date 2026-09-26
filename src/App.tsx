import { useEffect, useState } from 'react';
import { SkyCanvas } from './components/SkyCanvas';
import { ControlsPanel } from './components/ControlsPanel';
import { InfoCard } from './components/InfoCard';
import { loadStarCatalog, loadArabicEnrichment } from './core/starCatalog';
import { loadZodiacData } from './core/zodiac';
import { loadZodiacSigns } from './core/zodiacNamesAr';
import { loadStarGroups } from './core/starGroups';
import { loadEarthImage } from './core/earthImage';
import type { RenderOutput } from './render/skyRenderer';

export default function App() {
  const [output, setOutput] = useState<RenderOutput | null>(null);

  useEffect(() => {
    loadStarCatalog();
    loadArabicEnrichment(); // الإثراء العربي للنجوم، بالخلفية دون انتظار
    loadZodiacData();
    loadZodiacSigns(); // أسماء وحدود الأبراج الحقيقية من سوبابيز، بالخلفية أيضاً
    loadStarGroups(); // جديد — الكوكبات (groups/group_stars/group_lines) من سوبابيز
    // صورة الأرض الحقيقية: إن وُجدت معايرة افتراضية مُضمَّنة أو محفوظة محلياً، ستُستخدم هنا
    loadEarthImage();
  }, []);

  return (
    <div className="app-root">
      <ControlsPanel />
      <div className="stage">
        <SkyCanvas onFrame={setOutput} />
        <InfoCard output={output} />
      </div>
    </div>
  );
}