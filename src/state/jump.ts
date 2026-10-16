import { useSimulationStore } from './store';

/** يوقف الزمن ويقفز إلى لحظة معيّنة */
export function jumpTo(date: Date) {
  useSimulationStore.setState({ date, isPlaying: false, customTimeRateDegPerSec: null });
}

/** يشغّل المحاكاة بسرعة دقيقة لكل ثانية انطلاقاً من لحظة معيّنة */
export function playFrom(date: Date) {
  useSimulationStore.setState({ date, isPlaying: true, speedIndex: 1, customTimeRateDegPerSec: null });
}
