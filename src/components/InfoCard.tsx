import { useMemo } from 'react';
import type { RenderOutput } from '../render/skyRenderer';
import { getMansionByEclipticLongitude } from '../core/mansions';

interface Props {
  output: RenderOutput | null;
}

function fmtDeg(v: number): string {
  return `${v.toFixed(1)}°`;
}

export function InfoCard({ output }: Props) {
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

  return (
    <div className="info-card" aria-live="polite">
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