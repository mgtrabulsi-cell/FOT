export default function GamewirePercentage({ value, digits = 1 }: { value: number | null; digits?: number }) {
  const available = value !== null && Number.isFinite(value);
  return <span className={`gwb-percentage${available && value > 50 ? ' is-above-half' : ''}`}>
    {available ? `${value.toFixed(digits)}%` : 'Unavailable'}
  </span>;
}
