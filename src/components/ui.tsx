import { useState, type ElementType, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { useI18n } from '../i18n';
import { formatCoord, useSettings } from '../settings';

/* مكوّنات واجهة مشتركة بين لوحة التحكم وبقية القوائم (البحث، الكسوف…) */

/** صفحة تغلّف الشريط الجانبي بالكامل (حاسوب وموبايل)، وزر الرجوع يعيد القائمة السابقة. */
export function Flyout({ icon: Icon, title, onClose, children }: {
  icon: ElementType; title: string; onClose: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="popover-panel" role="dialog" aria-label={title}>
      <div className="popover-header">
        <button className="popover-back" onClick={onClose} aria-label={t('back')}><ArrowLeft size={18} className="back-ico" /></button>
        <Icon size={16} />
        <span className="popover-title-text">{title}</span>
      </div>
      <div className="popover-body">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="calendar-toggle" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      <div className="section-body">{children}</div>
    </div>
  );
}

export function NavRow({ icon: Icon, title, hint, active, badge, switchState, onClick }: {
  icon: ElementType; title: string; hint?: string; active?: boolean; badge?: boolean;
  switchState?: boolean; onClick: () => void;
}) {
  return (
    <button
      className="icon-trigger"
      data-active={!!active}
      aria-pressed={switchState}
      aria-expanded={switchState === undefined ? !!active : undefined}
      onClick={onClick}
      title={title}
    >
      <Icon size={18} />
      <span className="nav-text">
        <span className="icon-caption">{title}</span>
        {hint && <span className="nav-hint">{hint}</span>}
      </span>
      {badge && <span className="badge-dot" />}
      {switchState === undefined ? <ChevronRight size={14} className="nav-chev" /> : <span className="switch" data-on={switchState} aria-hidden />}
    </button>
  );
}

export function SwitchRow({ icon: Icon, label, checked, onChange }: {
  icon: ElementType; label: string; checked: boolean; onChange: () => void;
}) {
  return (
    <button className="switch-row" role="switch" aria-checked={checked} onClick={onChange}>
      <Icon size={16} />
      <span className="switch-label">{label}</span>
      <span className="switch" data-on={checked} aria-hidden />
    </button>
  );
}

export function StepperRow({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  const { t } = useI18n();
  return (
    <div className="stepper-row">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button className="stepper-btn" onClick={onDec} aria-label={t('dec', { label })}><Minus size={14} /></button>
        <span className="stepper-value num">{value}</span>
        <button className="stepper-btn" onClick={onInc} aria-label={t('inc', { label })}><Plus size={14} /></button>
      </div>
    </div>
  );
}

export function CoordField({ label, value, min, max, pos, neg, onCommit }: {
  label: string; value: number; min: number; max: number; pos: string; neg: string; onCommit: (n: number) => void;
}) {
  const { coordFormat } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const rounded = String(Number(value.toFixed(4)));
  const parsed = draft === null ? value : Number(draft.replace(',', '.'));
  const invalid = draft !== null && (draft.trim() === '' || !Number.isFinite(parsed) || parsed < min || parsed > max);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        className="coord-input"
        value={draft ?? rounded}
        data-invalid={invalid}
        aria-invalid={invalid}
        onFocus={() => setDraft(rounded)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value.replace(',', '.'));
          if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onCommit(n);
        }}
      />
      <span className="field-hint num">{formatCoord(value, pos, neg, coordFormat)}</span>
    </label>
  );
}

