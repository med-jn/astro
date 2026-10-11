import { useMemo } from 'react';
import type { RenderOutput } from '../render/skyRenderer';
import { getMansionByEclipticLongitude } from '../core/mansions';
import { useSimulationStore } from '../state/store';
import { getGroupById, getGroupAliases, getGroupMembers } from '../core/starGroups';

interface Props {
  output: RenderOutput | null;
}

function fmtDeg(v: number): string {
  return `${v.toFixed(1)}°`;
}

const SEASON_AR: Record<string, string> = {
  spring: 'الربيع', summer: 'الصيف', autumn: 'الخريف', winter: 'الشتاء',
};

export function InfoCard({ output }: Props) {
  const selectedGroupIds = useSimulationStore((s) => s.selectedGroupIds);

  const sunMansion = useMemo(
    () => (output ? getMansionByEclipticLongitude(output.sun.ecliptic?.longitudeDeg ?? 0) : null),
    [output]
  );
  const moonMansion = useMemo(
    () => (output ? getMansionByEclipticLongitude(output.moon.ecliptic?.longitudeDeg ?? 0) : null),
    [output]
  );

  if (!output) return null;
  const moonIllum = Math.round((output.moon.phaseFraction ?? 0) * 100);

  // بطاقة الكوكبة: آخر كوكبة مختارة (الأسماء البديلة + الهيئة + الموسم)
  const group = selectedGroupIds.length ? getGroupById(selectedGroupIds[selectedGroupIds.length - 1]) : undefined;
  const aliases = group ? getGroupAliases(group.id) : [];
  const starCount = group ? getGroupMembers(group.id).length : 0;
  const season = group?.season ? SEASON_AR[group.season] ?? group.season : null;

  return (
    <div className="info-card" aria-live="polite">
      {group && (
        <>
          <div className="info-row">
            <span className="badge">✦</span>
            <span className="info-label">كوكبة</span>
            <span className="info-value">
              {group.nameAr}
              {group.nameEn ? ` · ${group.nameEn}` : ''}
            </span>
          </div>
          {aliases.length > 0 && (
            <div className="info-row">
              <span className="info-label">تُعرف أيضاً</span>
              <span className="info-value">{aliases.join('، ')}</span>
            </div>
          )}
          {group.figureAr && (
            <div className="info-row">
              <span className="info-label">الهيئة</span>
              <span className="info-value">{group.figureAr}</span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">النجوم</span>
            <span className="info-value">
              {starCount}{season ? ` · موسمها ${season}` : ''}
            </span>
          </div>
        </>
      )}
      <div className="info-row">
        <span className="badge badge-sun">☀</span>
        <span className="info-label">منزلة الشمس</span>
        <span className="info-value">
          {sunMansion?.nameAr} ({(sunMansion?.index ?? 0) + 1}) · ميل {fmtDeg(output.sun.equatorial.declinationDeg)}
        </span>
      </div>
      <div className="info-row">
        <span className="badge badge-moon">☾</span>
        <span className="info-label">منزلة القمر</span>
        <span className="info-value">
          {moonMansion?.nameAr} ({(moonMansion?.index ?? 0) + 1}) · إضاءة {moonIllum}%
        </span>
      </div>
      <div className="info-row">
        <span className="badge badge-time">⏱</span>
        <span className="info-label">الزمن النجمي</span>
        <span className="info-value">بغرينتش {(output.gmstDeg / 15).toFixed(2)}س</span>
      </div>
    </div>
  );
}