export type ProjectionObservation = { eventId: string; date: string; value: number; opportunity: number | null };
export type ComparableObservation = ProjectionObservation & { allowance: number; defenseGames: number };
export type ProjectionEvidence = {
  foundation: number | null;
  independent: number | null;
  editorialAdjustment: number;
  matchup: 'Favorable' | 'Neutral' | 'Unfavorable' | 'Unverified';
  defense: { recent: number; season: number; games: number; opportunityAverage: number | null; opportunityGames: number; efficiency: number | null } | null;
  usage: { label: string; recent: number; recentGames: number; season: number; games: number; trend: 'Rising' | 'Stable' | 'Falling' | 'Limited sample'; efficiency: number | null } | null;
  comparable: { games: number; mean: number | null; median: number | null; weighted: number | null; adjustment: number; note: string };
  observed: { games: number; mean: number; median: number; low: number; high: number } | null;
  observations: ProjectionObservation[];
  confidence: 'Uncalibrated';
  risks: string[];
  edge: string;
};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(value * 100) / 100;
export function quantile(values: number[], fraction: number) {
  if (!values.length || values.some((value) => !Number.isFinite(value)) || !Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw new Error('Observed quantiles require finite samples and a valid fraction.');
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}
export function projectionIntelligence(input: {
  foundation: number | null; baseline: number | null; share: number | null; matchupReady: boolean; limited: boolean;
  observations: ProjectionObservation[]; opportunityLabel: string; recentAllowance: number | null;
  seasonAllowance: number | null; defenseGames: number; comparable: ComparableObservation[];
  upsideCap?: number;
  allowanceWeight?: number;
  defenseOpportunityAverage?: number | null; defenseOpportunityGames?: number; defenseEfficiency?: number | null;
}) {
  const { foundation, baseline, share, matchupReady, limited } = input;
  const observations = [...input.observations].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (observations.some((row) => !Number.isFinite(row.value) || !Number.isFinite(Date.parse(row.date))
    || row.opportunity !== null && (!Number.isInteger(row.opportunity) || row.opportunity < 0)))
    throw new Error('Projection evidence contains an invalid player observation.');
  const values = observations.map((row) => row.value);
  const opportunities = observations.filter((row) => row.opportunity !== null);
  const recentUsage = observations.slice(0, 3).filter((row) => row.opportunity !== null).map((row) => row.opportunity!);
  const olderUsage = observations.slice(3).filter((row) => row.opportunity !== null).map((row) => row.opportunity!);
  const recent = recentUsage.length ? mean(recentUsage) : null;
  const season = opportunities.length ? mean(opportunities.map((row) => row.opportunity!)) : null;
  const prior = olderUsage.length ? mean(olderUsage) : null;
  const trend = recentUsage.length < 3 || olderUsage.length < 3 || prior === 0 ? 'Limited sample'
    : recent! > prior! * 1.2 ? 'Rising' : recent! < prior! * .8 ? 'Falling' : 'Stable';
  const opportunityTotal = opportunities.reduce((sum, row) => sum + row.opportunity!, 0);
  const efficiency = opportunityTotal > 0 ? opportunities.reduce((sum, row) => sum + row.value, 0) / opportunityTotal : null;
  const recentAllowance = input.recentAllowance, seasonAllowance = input.seasonAllowance;
  const blendedAllowance = recentAllowance !== null && seasonAllowance !== null ? .4 * recentAllowance + .6 * seasonAllowance : null;
  const defenseDelta = matchupReady && baseline !== null && share !== null && blendedAllowance !== null && recentAllowance !== null
    ? (input.allowanceWeight ?? (limited ? .15 : .3)) * share * (blendedAllowance - recentAllowance) : 0;
  const comparable = [...new Map(input.comparable.map((row) => [row.eventId, row])).values()]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).filter((row) => row.defenseGames >= 3 && row.allowance >= 0
    && blendedAllowance !== null && Math.abs(row.allowance - blendedAllowance) <= Math.max(1, blendedAllowance * .2)
    && recent !== null && recent > 0 && row.opportunity !== null && row.opportunity > 0
    && Math.abs(row.opportunity / recent - 1) <= .3);
  const comparableValues = comparable.map((row) => row.value);
  let weighted: number | null = null, adjustment = 0;
  if (comparable.length >= 3 && recentUsage.length === 3 && matchupReady && !limited && baseline !== null && baseline > 0 && share !== null) {
    const residuals = comparable.map((row) => {
      const expected = .7 * baseline + .3 * row.allowance * share;
      return (row.value * recent! / row.opportunity! - expected) / baseline;
    });
    const low = quantile(residuals, .25), high = quantile(residuals, .75);
    const weights = comparable.map((_, index) => .85 ** index);
    const residual = residuals.reduce((sum, value, index) => sum + clamp(value, low, high) * weights[index], 0) / weights.reduce((sum, weight) => sum + weight, 0);
    adjustment = clamp(residual * .15 * comparable.length / (comparable.length + 5), -.05, .05);
    weighted = comparableValues.reduce((sum, value, index) => sum + value * weights[index], 0) / weights.reduce((sum, weight) => sum + weight, 0);
  }
  const risks = [
    'No calibrated forecast distribution or over/under probability is available. Observed ranges are past results, not prediction intervals.',
    'Coverage scheme, routes, snap share, personnel changes, weather, pace, spread and totals are not verified inputs; no adjustments are invented for them.',
    'Raw defensive allowance is not a schedule-strength-adjusted rating. Similarity uses recorded allowance and opportunity, not verified schemes, personnel, health or coaching continuity.',
  ];
  if (limited) risks.push('Small, incomplete or stale samples limit matchup adjustments.');
  if (trend === 'Rising' || trend === 'Falling') risks.push(`${trend} opportunity is a descriptive trend, not proof of a permanent role change; it is not multiplied into the recent-weighted baseline again.`);
  if (recent === null) risks.push('Target/carry/attempt volume is unverified; efficiency and role-matched comparisons are omitted.');
  else if (recentUsage.length < 3) risks.push('Recent opportunity coverage is incomplete; no comparable-defense adjustment is applied.');
  if (comparable.length < 3) risks.push('Fewer than three role-matched comparable-defense games; no comparable-defense adjustment.');
  const matchup = !matchupReady || blendedAllowance === null || baseline === null || share === null ? 'Unverified'
    : blendedAllowance * share > baseline * 1.1 ? 'Favorable' : blendedAllowance * share < baseline * .9 ? 'Unfavorable' : 'Neutral';
  const raw = foundation === null ? null : foundation + defenseDelta + foundation * adjustment;
  const scaleBaseline = baseline !== null && baseline > 0 ? baseline : foundation;
  const independent = raw === null ? null : Math.max(0, scaleBaseline !== null && matchupReady
    ? clamp(raw, scaleBaseline * (limited ? .85 : .75), scaleBaseline * (limited ? 1.15 : input.upsideCap ?? 1.25)) : raw);
  const evidence: ProjectionEvidence = {
    foundation, independent: independent === null ? null : round(independent), editorialAdjustment: 0, matchup,
    defense: recentAllowance === null || seasonAllowance === null ? null : { recent: round(recentAllowance), season: round(seasonAllowance), games: input.defenseGames,
      opportunityAverage: input.defenseOpportunityAverage == null ? null : round(input.defenseOpportunityAverage),
      opportunityGames: input.defenseOpportunityGames ?? 0,
      efficiency: input.defenseEfficiency == null ? null : round(input.defenseEfficiency) },
    usage: recent === null || season === null ? null : { label: input.opportunityLabel, recent: round(recent), recentGames: recentUsage.length, season: round(season), games: opportunities.length, trend, efficiency: efficiency === null ? null : round(efficiency) },
    comparable: { games: comparable.length, mean: comparableValues.length ? round(mean(comparableValues)) : null,
      median: comparableValues.length ? round(quantile(comparableValues, .5)) : null, weighted: weighted === null ? null : round(weighted),
      adjustment: round(adjustment * 100), note: 'Same-team current-season games; pre-kickoff positional allowance within 20%, volume within 30%. At least three samples required. Residual adjustment removes the allowance already modeled, shrinks small samples and caps at +/-5%; no scheme similarity is claimed.' },
    observed: values.length < 3 ? null : { games: values.length, mean: round(mean(values)), median: round(quantile(values, .5)), low: round(quantile(values, .25)), high: round(quantile(values, .75)) },
    observations, confidence: 'Uncalibrated', risks,
    edge: matchup === 'Unverified' ? 'Production fallback only; no verified matchup edge.'
      : `${matchup} position-specific ${input.opportunityLabel === 'Targets' ? 'receiving' : input.opportunityLabel === 'Carries' ? 'rushing' : 'passing'} allowance versus measured player share.${adjustment ? ' Role-matched historical residual adds a bounded adjustment.' : ''} Not an actionable betting edge or recommendation.`,
  };
  return { estimate: independent, evidence };
}
export function observedLineComparison(estimate: number, line: number, observations: ProjectionObservation[]) {
  if (!Number.isFinite(estimate) || !Number.isFinite(line) || line < 0 || observations.some((row) => !Number.isFinite(row.value)))
    throw new Error('Saved-line comparison requires a valid projection, line and recorded samples.');
  const over = observations.filter((row) => row.value > line).length, under = observations.filter((row) => row.value < line).length;
  return { line, difference: round(estimate - line), assessment: estimate > line ? 'Above saved line' : estimate < line ? 'Below saved line' : 'At saved line',
    games: observations.length, over: observations.filter((row) => row.value > line).length,
    under, pushes: observations.filter((row) => row.value === line).length,
    observedOverRate: observations.length ? round(100 * over / observations.length) : null,
    observedUnderRate: observations.length ? round(100 * under / observations.length) : null };
}
