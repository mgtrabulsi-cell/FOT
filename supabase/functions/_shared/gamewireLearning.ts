export type LearningSample = { id: string; eventId: string; start: string; recordedAt: string; settledAt: string; prediction: number; actual: number };
export type LearningAdjustment = {
  version: 'walk-forward-v1'; mode: 'stat' | 'probability'; adjustment: number; active: boolean;
  trainingGames: number; validationGames: number; baselineError: number | null; adjustedError: number | null;
  through: string | null; sampleIds: string[];
};
export const pickLearningKey = (market: string, side: string) => `${market}:${side === 'Under' ? 'under' : side === 'Over' ? 'over' : 'team'}`;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const adjustedPrediction = (prediction: number, mode: LearningAdjustment['mode'], adjustment: number) =>
  mode === 'stat' ? Math.max(0, prediction * adjustment) : Math.max(.01, Math.min(.99, prediction + adjustment));
export function adjustedPickProbability(prediction: number, market: string, side: string, adjustment: number) {
  if (pickLearningKey(market, side).endsWith(':team')) {
    if (prediction === .5) return prediction;
    const favored = adjustedPrediction(Math.max(prediction, 1 - prediction), 'probability', adjustment);
    return prediction > .5 ? favored : 1 - favored;
  }
  return adjustedPrediction(prediction, 'probability', adjustment);
}

export function learnAdjustment(samples: LearningSample[], mode: LearningAdjustment['mode'], cutoff: number): LearningAdjustment {
  const neutral = mode === 'stat' ? 1 : 0;
  const result: LearningAdjustment = { version: 'walk-forward-v1', mode, adjustment: neutral, active: false,
    trainingGames: 0, validationGames: 0, baselineError: null, adjustedError: null, through: null, sampleIds: [] };
  // One observation per game prevents repeat searches, revisions and same-game selections from inflating evidence.
  const events = new Map<string, LearningSample>();
  for (const row of [...samples].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id))) {
    const start = Date.parse(row.start), recorded = Date.parse(row.recordedAt), settled = Date.parse(row.settledAt);
    if (!row.id || !row.eventId || ![start, recorded, settled, row.prediction, row.actual].every(Number.isFinite)
      || recorded >= start || settled < start || settled >= cutoff || start >= cutoff
      || mode === 'stat' && row.prediction <= 0
      || mode === 'probability' && (row.prediction <= 0 || row.prediction >= 1 || ![0, 1].includes(row.actual))) continue;
    if (!events.has(row.eventId)) events.set(row.eventId, row);
  }
  const rows = [...events.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(-160);
  if (!rows.length) return result;
  const split = Math.floor(rows.length * .75), validation = rows.slice(split), validationStart = Date.parse(validation[0].start);
  const training = rows.slice(0, split).filter(row => Date.parse(row.settledAt) < validationStart);
  result.trainingGames = training.length; result.validationGames = validation.length;
  result.through = rows[rows.length - 1].settledAt;
  result.sampleIds = [...training, ...validation].map(row => row.id);
  if (rows.length < 40 || training.length < 30 || validation.length < 10) return result;
  const error = (sample: LearningSample[], adjustment: number) => average(sample.map(row => {
    const difference = adjustedPrediction(row.prediction, mode, adjustment) - row.actual;
    return mode === 'stat' ? Math.abs(difference) : difference ** 2;
  }));
  const logLoss = (sample: LearningSample[], adjustment: number) => average(sample.map(row => {
    const p = adjustedPrediction(row.prediction, 'probability', adjustment);
    return -(row.actual * Math.log(p) + (1 - row.actual) * Math.log(1 - p));
  }));
  const candidates = Array.from({ length: 21 }, (_, index) => mode === 'stat' ? .9 + index * .01 : -.05 + index * .005);
  const best = candidates.sort((a, b) => error(training, a) - error(training, b) || Math.abs(a - neutral) - Math.abs(b - neutral))[0];
  result.baselineError = error(validation, neutral); result.adjustedError = error(validation, best);
  const requiredImprovement = mode === 'stat' ? .05 : .02;
  result.active = Math.abs(best - neutral) > 1e-8 && result.baselineError > 0
    && result.adjustedError <= result.baselineError * (1 - requiredImprovement)
    && (mode !== 'probability' || logLoss(validation, best) <= logLoss(validation, neutral));
  if (result.active) result.adjustment = Math.round(best * 10000) / 10000;
  return result;
}
