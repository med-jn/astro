import { useEffect } from 'react';
import { useSimulationStore } from './state/store';
import { MapCalibrator } from './components/MapCalibrator';

/**
 * تطبيق مستقل بالكامل لأداة المعايرة، يُحمَّل فقط عبر calibrate.html (غير مبني ضمن dist/).
 * يستخدم نفس المتجر (Zustand store) ونفس مفتاح localStorage الذي يقرأه التطبيق الرئيسي،
 * لذا أي معايرة تُجرى هنا تنعكس تلقائياً في التطبيق الرئيسي عند إعادة تحميله لاحقاً —
 * بلا أي حاجة لمزامنة يدوية بين الصفحتين.
 */
export default function CalibrateApp() {
  const isCalibrating = useSimulationStore((s) => s.isCalibrating);
  const startCalibrating = useSimulationStore((s) => s.startCalibrating);

  useEffect(() => {
    // هذه الصفحة مخصصة للمعايرة فقط، فنفتح الواجهة تلقائياً عند التحميل
    startCalibrating();
  }, [startCalibrating]);

  if (!isCalibrating) {
    return (
      <div className="calibrate-closed">
        أُغلقت أداة المعايرة. أعد تحميل الصفحة لبدء معايرة جديدة.
      </div>
    );
  }

  return <MapCalibrator />;
}