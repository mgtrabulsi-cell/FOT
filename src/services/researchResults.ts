import { fetchNBASummary } from './nbaData';
import { nbaStatValue } from './nbaStats';
import { fetchNFLBoxScore } from './sportsData';
import type { ResearchSnapshot, ResearchResult, ResearchSection } from './research';

export async function checkResearchResult(snapshot: ResearchSnapshot, signal: AbortSignal): Promise<ResearchResult> {
  const { game, player } = snapshot;
  if (!game) throw new Error('No verified matchup was saved with this research.');
  if (player && ![game.homeId, game.awayId].includes(player.teamId))
    throw new Error('The saved player team does not match this matchup. Save fresh research from the correct player card.');
  if (!navigator.onLine) throw new Error('Reconnect to check final results. Your saved research and notes still work offline.');
  let sections: ResearchSection[];
  if (snapshot.league === 'NBA') {
    const summary = await fetchNBASummary(game.eventId, signal);
    if (summary.eventId !== game.eventId || ![game.homeId, game.awayId].every(id => summary.teams.some(team => team.id === id)))
      throw new Error('The returned game does not match your saved matchup.');
    if (summary.status !== 'post') throw new Error('A verified final is not available yet. Check again after the game.');
    if (!Number.isFinite(summary.homeScore) || !Number.isFinite(summary.awayScore)) throw new Error('Final scores are incomplete. Retry later.');
    sections = [{ title: 'Recorded final score', rows: [
      { label: game.away, value: String(summary.awayScore) }, { label: game.home, value: String(summary.homeScore) },
    ] }];
    for (const team of summary.teams) {
      if (player && team.id !== player.teamId) continue;
      const athletes = team.players.filter(row => !player || row.id === player.id);
      if (player && !athletes.length) throw new Error('This player has no verified final box-score entry yet. Retry later.');
      sections.push({ title: team.id === game.homeId ? game.home : game.away, rows: athletes.map(row => ({
        label: row.name, value: row.didNotPlay ? `Did not play${row.reason ? `: ${row.reason}` : ''}`
          : (['points', 'rebounds', 'assists', 'pra', 'threePointersMade'] as const).map((stat, index) =>
            `${['PTS', 'REB', 'AST', 'PRA', '3PM'][index]}: ${nbaStatValue(row.stats, stat) ?? 'Unavailable'}`).join(' / '),
      })) });
    }
  } else {
    const summary = await fetchNFLBoxScore('football/nfl', game.eventId, signal);
    if (summary.eventId !== game.eventId || ![game.homeId, game.awayId].every(id => summary.teams.some(team => team.id === id)))
      throw new Error('The returned game does not match your saved matchup.');
    if (!summary.isFinal || summary.state !== 'post') throw new Error('A verified final is not available yet. Check again after the game.');
    if (summary.teams.some(team => !team.score.trim() || !Number.isFinite(Number(team.score))))
      throw new Error('Final scores are incomplete. Retry later.');
    sections = [{ title: 'Recorded final score', rows: summary.teams.map(team => ({ label: team.abbreviation, value: team.score })) }];
    let found = !player;
    for (const team of summary.teams) {
      if (player && team.id !== player.teamId) continue;
      for (const category of team.categories) {
        const athletes = category.athletes.filter(row => !player || row.id === player.id);
        if (athletes.length) found = true;
        if (athletes.length) sections.push({ title: `${team.abbreviation} / ${category.title}`, rows: athletes.map(row => ({
          label: row.name, value: category.labels.map((label, index) => `${label}: ${row.stats[index] || 'Unavailable'}`).join(' / '),
        })) });
      }
    }
    if (!found) throw new Error('This player has no verified final box-score entry yet. Retry later.');
  }
  signal.throwIfAborted();
  return { checkedAt: new Date().toISOString(), sections };
}
