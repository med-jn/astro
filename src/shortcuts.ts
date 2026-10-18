import type { TKey } from './i18n';

/**
 * اختصارات لوحة المفاتيح: تعريف واحد يُعرض في صفحة الإعدادات (ShortcutsGuide) ويُنفَّذ في GlobalShortcuts
 * وفي ObserverView (مجموعة «عين الراصد») وSkyCanvas (مجموعة «الخريطة»). تُعرَّف المفاتيح برمزها الفعلي
 * (KeyboardEvent.code) فتعمل مع أي لغة للوحة المفاتيح؛ الحروف المعروضة هي حروف التخطيط اللاتيني للمرجع.
 */
export type ShortcutGroup = 'general' | 'time' | 'layers' | 'eye' | 'map';
export interface ShortcutDef { group: ShortcutGroup; keys: string[]; label: TKey }

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['general', 'time', 'layers', 'eye', 'map'];
export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, TKey> = {
  general: 'sc_group_general', time: 'sc_group_time', layers: 'sc_group_layers', eye: 'sc_group_eye', map: 'sc_group_map',
};

export const SHORTCUTS: ShortcutDef[] = [
  { group: 'general', keys: ['?'], label: 'sc_help' },
  { group: 'general', keys: ['E'], label: 'sc_eye' },
  { group: 'general', keys: ['F'], label: 'sc_fullscreen' },
  { group: 'general', keys: ['Esc'], label: 'sc_close' },
  { group: 'time', keys: ['Space'], label: 'sc_play' },
  { group: 'time', keys: ['N'], label: 'sc_now' },
  { group: 'time', keys: [']', '['], label: 'sc_speed' },
  { group: 'time', keys: ['.', ','], label: 'sc_hour' },
  { group: 'time', keys: ['Shift + .', 'Shift + ,'], label: 'sc_day' },
  { group: 'layers', keys: ['D'], label: 'nav_dome' },
  { group: 'layers', keys: ['P'], label: 'layer_planets' },
  { group: 'layers', keys: ['L'], label: 'layer_labels' },
  { group: 'layers', keys: ['C'], label: 'layer_ecliptic' },
  { group: 'layers', keys: ['A'], label: 'layer_aurora' },
  { group: 'eye', keys: ['←', '→', '↑', '↓'], label: 'sc_eye_look' },
  { group: 'eye', keys: ['+', '−', 'PgUp', 'PgDn'], label: 'sc_eye_zoom' },
  { group: 'eye', keys: ['Home'], label: 'sc_eye_home' },
  { group: 'eye', keys: ['Shift + S', 'Shift + M'], label: 'sc_eye_track' },
  { group: 'eye', keys: ['X'], label: 'sc_eye_untrack' },
  { group: 'eye', keys: ['V'], label: 'sc_eye_filter' },
  { group: 'eye', keys: ['S'], label: 'sc_eye_sun' },
  { group: 'eye', keys: ['M'], label: 'sc_eye_moon' },
  { group: 'eye', keys: ['Z'], label: 'sc_eye_zenith' },
  { group: 'eye', keys: ['T'], label: 'sc_eye_dial' },
  { group: 'eye', keys: ['1', '2', '3'], label: 'sc_eye_proj' },
  { group: 'map', keys: ['←', '→', '↑', '↓'], label: 'sc_map_pan' },
  { group: 'map', keys: ['Shift + ←', 'Shift + →'], label: 'sc_map_rotate' },
  { group: 'map', keys: ['+', '−', 'Shift + ↑', 'Shift + ↓'], label: 'sc_map_zoom' },
];
