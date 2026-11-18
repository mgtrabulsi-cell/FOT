import { nbaSimulationBox, nbaSimulationRoster, nbaSimulationSchedule, simulateNBAGame } from './nbaSimulation.ts';
import type { NBASimulationGame, NBAObservation, NBAReference, NBASimulationLearning } from './nbaSimulation.ts';
import type { SimulationCache } from './nflSimulationSources.ts';

export const nbaSimulationSite = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
export type NBASimulationJob = { createdAt: string; references: NBAReference[] };
type Get = (url: string) => Promise<unknown>;
const unique = (refs: NBAReference[]) => [...new Map(refs.map(row => [`${row.teamId}:${row.id}`, row])).values()]
  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
export async function prepareNBASimulation(game: NBASimulationGame, get: Get, cache: SimulationCache, now: number): Promise<NBASimulationJob> {
  const history = async (teamId: string) => {
    let rows: NBAReference[] = [];
    for (let season = game.season; season >= game.season - 2 && rows.length < 100; season--) {
      for (const phase of [2, 3]) {
        const key = `nba:simulation:schedule:v1:${teamId}:${season}:${phase}`;
        const saved = (await cache.readMany<NBAReference[]>([key])).get(key);
        const refs = saved ?? nbaSimulationSchedule(await get(`${nbaSimulationSite}/teams/${teamId}/schedule?season=${season}&seasontype=${phase}&limit=1000`), teamId, now);
        if (!saved) await cache.write(key, refs, season === game.season ? 5 * 60000 : 365 * 86400000);
        rows = unique([...rows, ...refs]).filter(row => Date.parse(row.date) < now).slice(0, 100);
      }
    }
    return rows;
  };
  const refs = await Promise.all([history(game.home.id), history(game.away.id)]);
  return { createdAt: new Date(now).toISOString(), references: unique(refs.flat()) };
}
export async function nbaSimulationRosters(game: NBASimulationGame, get: Get) {
  return (await Promise.all([game.home, game.away].map(async team =>
    nbaSimulationRoster(await get(`${nbaSimulationSite}/teams/${team.id}/roster?season=${game.season}`), team.id)))).flat();
}
export async function advanceNBASimulation(game: NBASimulationGame, job: NBASimulationJob, get: Get, cache: SimulationCache,
  roster: Awaited<ReturnType<typeof nbaSimulationRosters>>, now: number, learning: NBASimulationLearning) {
  const key = (id: string) => `nba:simulation:box:v2:${id}`;
  const ids = [...new Set(job.references.map(row => row.id))];
  const boxes = await cache.readMany<NBAObservation[]>(ids.map(key));
  // Alternate teams so a first usable forecast does not wait for one team's entire backfill.
  const refs = [game.home.id, game.away.id].map(id => job.references.filter(row => row.teamId === id));
  const missing = Array.from({ length: Math.max(...refs.map(rows => rows.length), 0) }, (_, i) =>
    refs.flatMap(rows => rows[i] ? [rows[i]] : [])).flat().filter(row => !boxes.has(key(row.id)));
  const batch = [...new Map(missing.map(row => [row.id, row])).values()].slice(0, 12);
  let next = 0;
  const issues: string[] = [];
  await Promise.all(Array.from({ length: Math.min(3, batch.length) }, async () => {
    while (next < batch.length) {
      const ref = batch[next++];
      try {
        const raw = await get(`${nbaSimulationSite}/summary?event=${ref.id}`);
        const rows = nbaSimulationBox(raw, ref.id, now);
        if (!rows.some(row => row.teamId === ref.teamId && row.opponentId === ref.opponentId && Date.parse(row.date) === Date.parse(ref.date)))
          throw new Error('NBA historical box score does not match the scheduled reference.');
        await cache.write(key(ref.id), rows, 365 * 86400000);
        boxes.set(key(ref.id), rows);
      } catch (cause) {
        console.error('NBA simulation historical box unavailable', ref.id, cause);
        issues.push(`${ref.id}: ${cause instanceof Error ? cause.message : 'Historical stats unavailable.'}`);
      }
    }
  }));
  const observations = job.references.flatMap(ref => (boxes.get(key(ref.id)) ?? []).filter(row =>
    row.teamId === ref.teamId && row.opponentId === ref.opponentId && Date.parse(row.date) === Date.parse(ref.date)));
  const result = simulateNBAGame(game, observations, roster, now, learning);
  const remaining = ids.filter(id => !boxes.has(key(id))).length;
  return { result: { ...result, refreshing: result.status === 'ready' && remaining > 0,
    stage: result.status === 'ready' && remaining ? `Simulation ready · ${remaining} historical games still preparing` : result.stage,
    warnings: [...result.warnings, ...issues] }, remaining, issues };
}
