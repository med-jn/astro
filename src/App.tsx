import { useEffect, useState } from 'react';
import { SkyCanvas } from './components/SkyCanvas';
import { ControlsPanel } from './components/ControlsPanel';
import { InfoCard } from './components/InfoCard';
import { loadStarCatalog, loadArabicEnrichment } from './core/starCatalog';
import { loadZodiacData } from './core/zodiac';
import { loadEarthImage } from './core/earthImage';
import type { RenderOutput } from './render/skyRenderer';

export default function App() {
  const [output, setOutput] = useState<RenderOutput | null>(null);

  useEffect(() => {
    loadStarCatalog();
    loadArabicEnrichment(); // جديد — الإثراء العربي، بالخلفية دون انتظار
    loadZodiacData();
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