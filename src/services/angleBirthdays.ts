import { fetchNFLActiveSkillRoster } from './sportsData';
import type { Game, NFLRosterSkillPlayer } from './sportsData';
import { birthdayNearGame, readPlayerBirthdays } from './theAngle';
import type { AngleSuggestion } from './theAngle';

export async function fetchBirthdaySuggestions(games: Game[], signal: AbortSignal) {
  const rosterEntries: Array<{ game: Game; player: NFLRosterSkillPlayer; team: string }> = [];
  const errors: string[] = [];
  for (let start = 0; start < games.length; start += 4) {
    await Promise.all(games.slice(start, start + 4).flatMap((game) => [game.away, game.home].map(async (team) => {
      try {
        const players = await fetchNFLActiveSkillRoster(game.feedPath, team.id, game.seasonYear);
        if (!signal.aborted) players.forEach((player) => rosterEntries.push({ game, player, team: team.abbr }));
      } catch (cause) {
        if (!signal.aborted) errors.push(`${team.abbr} birthday roster: ${cause instanceof Error ? cause.message : 'Roster unavailable.'}`);
      }
    })));
    if (signal.aborted) return { suggestions: [], errors };
  }
  const ids = [...new Set(rosterEntries.map(({ player }) => player.id).filter((id) => /^\d{1,15}$/.test(id)))];
  const birthdays = [];
  for (let start = 0; start < ids.length; start += 150) {
    const query = `SELECT DISTINCT ?espn ?person ?dob WHERE {
      VALUES ?espn { ${ids.slice(start, start + 150).map((id) => `"${id}"`).join(' ')} }
      ?person wdt:P3686 ?espn; p:P569 ?statement.
      ?statement ps:P569 ?dob; psv:P569 ?dateValue; wikibase:rank ?rank.
      ?dateValue wikibase:timePrecision ?precision.
      FILTER(?precision >= 11 && ?rank != wikibase:DeprecatedRank)
    }`;
    const request = new AbortController();
    const cancel = () => request.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = window.setTimeout(() => request.abort(), 25_000);
    try {
      const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
        signal: request.signal, headers: { Accept: 'application/sparql-results+json' },
      });
      if (!response.ok) throw new Error(`Wikidata returned HTTP ${response.status}`);
      birthdays.push(...readPlayerBirthdays(await response.json(), (message) => errors.push(message)));
    } catch (cause) {
      if (!signal.aborted) errors.push(`Birthday lookup: ${cause instanceof Error ? cause.message : 'Wikidata unavailable.'}`);
    } finally {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
    }
    if (signal.aborted) return { suggestions: [], errors };
  }
  const suggestions: AngleSuggestion[] = [];
  const byId = new Map(birthdays.map((birthday) => [birthday.playerId, birthday]));
  rosterEntries.forEach(({ game, player, team }) => {
    const birthday = byId.get(player.id);
    const nearby = birthday && birthdayNearGame(birthday.dateOfBirth, game.date);
    if (!birthday || !nearby) return;
    suggestions.push({
      key: `${game.id}:birthday:${player.id}`, game, category: 'Birthday', sourceLabel: 'Wikidata biography (CC0)',
      playerName: player.name,
      article: {
        id: `birthday:${player.id}:${nearby.date}`, favoriteKey: `player:${game.feedPath}:${player.id}`,
        favoriteName: player.name, favoriteType: 'player', published: `${nearby.date}T12:00:00Z`,
        headline: `${player.name} (${team}) · ${nearby.onGameDay ? 'Birthday on game day' : 'Birthday near game day'} · ${nearby.date}`,
        description: 'Birth date matched by player ID in Wikidata. Verify the biography and current roster before publishing; a birthday is not a performance signal.',
        url: birthday.sourceUrl,
      },
    });
  });
  return { suggestions, errors };
}
