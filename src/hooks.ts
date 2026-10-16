import { useEffect, useRef, useState } from 'react';
import { useSimulationStore } from './state/store';

/**
 * قيمة تُحدَّث على فترات منتظمة لا في كل إطار: تخفّف الرسم الثقيل (كانفاس بكسلي) أثناء تشغيل الزمن.
 * (مؤقّت دوري لا debounce، كي لا يتجوّع التحديث أثناء التغيّر المستمر.)
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const id = setInterval(() => setV(latest.current), ms);
    return () => clearInterval(id);
  }, [ms]);
  return v;
}

/**
 * تاريخ المحاكاة بتحديث دوري بدل الاشتراك في كل إطار.
 * الاشتراك المباشر في `date` يعيد رسم المكوّن 60 مرة في الثانية أثناء تشغيل الزمن؛ هنا يُقرأ على فترات.
 * (للقراءة اللحظية داخل معالجات النقر استعمل useSimulationStore.getState().date.)
 */
export function useSimDate(ms: number): Date {
  const [d, setD] = useState(() => useSimulationStore.getState().date);
  useEffect(() => {
    const id = setInterval(() => {
      const nd = useSimulationStore.getState().date;
      setD((prev) => (prev === nd ? prev : nd));
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return d;
}
