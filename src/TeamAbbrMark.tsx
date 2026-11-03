import type { CSSProperties } from 'react';

export function teamMarkColor(color?: string) {
  const hex = (color ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : '#8ba2c3';
}

export function teamMarkAbbr(abbr?: string) {
  const label = (abbr ?? '').trim().toUpperCase();
  return label.slice(0, 4) || '—';
}

export default function TeamAbbrMark({
  abbr,
  color,
  name,
  large = false,
  className = '',
}: {
  abbr?: string;
  color?: string;
  name?: string;
  large?: boolean;
  className?: string;
}) {
  const label = teamMarkAbbr(abbr);
  return (
    <span
      className={`team-mark${large ? ' team-mark-large' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--team-color': teamMarkColor(color) } as CSSProperties}
      title={name || undefined}
      aria-label={name || label}
    >
      <b>{label}</b>
    </span>
  );
}
