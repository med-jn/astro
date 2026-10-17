import { useI18n } from '../i18n';
import { SHORTCUTS, SHORTCUT_GROUPS, SHORTCUT_GROUP_LABEL } from '../shortcuts';

/** إرشادات الاختصارات في صفحة الإعدادات (من تعريف shortcuts.ts نفسه) */
export function ShortcutsGuide() {
  const { t } = useI18n();
  return (
    <div className="sc-guide">
      {SHORTCUT_GROUPS.map((g) => (
        <div key={g} className="sc-group">
          <div className="sc-group-title">{t(SHORTCUT_GROUP_LABEL[g])}</div>
          {SHORTCUTS.filter((s) => s.group === g).map((s) => (
            <div key={s.label + s.keys.join('')} className="sc-row">
              <span>{t(s.label)}</span>
              <span className="sc-keys">{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
            </div>
          ))}
        </div>
      ))}
      <p className="sc-note">{t('set_shortcuts_note')}</p>
    </div>
  );
}
