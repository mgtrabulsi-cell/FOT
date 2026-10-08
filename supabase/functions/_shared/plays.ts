export type PlayFavorite = { type?: string; id?: string; teamId?: string; name?: string; position?: string; feedPath?: string };
export type PlayGame = { id: string; away: { id: string; abbreviation: string }; home: { id: string; abbreviation: string } };
export type PlayAlert = { playId: string; favoriteKey: string; body: string; isPlayerAlert: boolean };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = '') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nameAliases(name: string) {
  const parts = name.match(/[a-z0-9]+/gi) ?? [];
  if (parts.length < 2) return [];
  const firstInitial = parts[0]?.[0] ?? '';
  const surname = parts.slice(1).filter((part) => !/^(jr|sr|ii|iii|iv)$/i.test(part));
  const lastName = surname[surname.length - 1];
  return [...new Set([
    normalize(`${firstInitial}${surname.join('')}`),
    normalize(`${firstInitial}${lastName}`),
  ])];
}

function mentionsPlayer(description: string, name: string) {
  const normalized = normalize(description);
  return nameAliases(name).some((alias) => alias.length > 2 && normalized.includes(alias));
}

function playYards(play: Record<string, unknown>, description: string) {
  const stat = Number(play.statYardage);
  if (Number.isFinite(stat)) return stat;
  const match = description.match(/\bfor\s+(-?\d+)\s+yards?\b/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function summaryPlayIds(summary: unknown) {
  return extractPlays(summary).map(({ play }) => str(play.id)).filter(Boolean);
}

function extractPlays(summary: unknown) {
  const drives = record(record(summary).drives);
  return [...list(drives.previous), ...list(drives.current)].flatMap((drive) => {
    const driveRecord = record(drive);
    const driveTeamId = str(record(driveRecord.team).id);
    return list(driveRecord.plays).map((play) => ({ play: record(play), driveTeamId }));
  });
}

export function buildPlayAlerts(summary: unknown, game: PlayGame, favorites: Array<PlayFavorite & { key: string }>, newPlayIds: Set<string>): PlayAlert[] {
  const scoringTeamByPlayId = new Map(list(record(summary).scoringPlays).map(record)
    .map((scoringPlay) => [str(scoringPlay.id), str(record(scoringPlay.team).id)] as const));

  return extractPlays(summary).flatMap(({ play, driveTeamId }) => {
    const playId = str(play.id);
    if (!playId || !newPlayIds.has(playId)) return [];
    const description = str(play.text);
    const playType = str(record(play.type).text).toLowerCase();
    const isPass = playType.includes('pass') || /\bpass\b/i.test(description);
    const isRush = playType.includes('rush') || /\b(rush|runs?)\b/i.test(description);
    const isCatch = isPass && /\bto\b/i.test(description) && !/incomplete|intercepted|sacked/i.test(description);
    const isTouchdown = playType.includes('touchdown') || /touchdown/i.test(description);
    const isScoringPlay = play.scoringPlay === true || isTouchdown;
    const yards = playYards(play, description);
    const participants = list(play.teamParticipants).map(record);
    const offenseTeamId = str(participants.find((participant) => str(participant.type).toLowerCase() === 'offense')?.id, driveTeamId);
    const defenseTeamId = str(participants.find((participant) => str(participant.type).toLowerCase() === 'defense')?.id,
      offenseTeamId === game.home.id ? game.away.id : game.home.id);
    const scoringTeamId = scoringTeamByPlayId.get(playId) ?? (isScoringPlay ? offenseTeamId : '');

    return favorites.flatMap((favorite): PlayAlert[] => {
      const teamId = favorite.type === 'team' ? favorite.id : favorite.teamId;
      if (teamId !== game.home.id && teamId !== game.away.id) return [];
      const teamAbbr = teamId === game.home.id ? game.home.abbreviation : game.away.abbreviation;

      if (favorite.type === 'player') {
        const name = favorite.name ?? '';
        const position = favorite.position?.toUpperCase();
        if (!name || !mentionsPlayer(description, name)) return [];
        let body = '';
        if (isTouchdown) {
          if (position === 'QB' && isPass && /\bpass from\b/i.test(description)) body = `${name} just threw a ${yards > 0 ? `${yards} yard ` : ''}touchdown pass`;
          else if ((position === 'QB' || position === 'RB') && isRush) body = `${name} just ran for a ${yards > 0 ? `${yards} yard ` : ''}touchdown`;
          else if ((position === 'RB' || position === 'WR' || position === 'TE') && isCatch) body = `${name} just caught a ${yards > 0 ? `${yards} yard ` : ''}touchdown`;
        } else if (position === 'QB' && isPass && yards > 50) {
          body = `${name} just threw a ${yards} yard pass`;
        } else if (position === 'RB' && isRush && yards > 25) {
          body = `${name} just ran for ${yards} yards`;
        } else if ((position === 'RB' || position === 'WR' || position === 'TE') && isCatch && yards > 25) {
          body = `${name} just caught a ${yards} yard reception`;
        }
        return body ? [{ playId, favoriteKey: String(favorite.key), body, isPlayerAlert: true }] : [];
      }

      const onDefense = defenseTeamId === teamId;
      const onOffense = offenseTeamId === teamId;
      let label = '';
      if (onDefense && play.isTurnover === true) label = isTouchdown && scoringTeamId === teamId ? 'Defensive touchdown' : 'Defensive turnover';
      else if (scoringTeamId === teamId) label = isTouchdown ? (onOffense ? 'Touchdown' : 'Defensive touchdown') : 'Scoring play';
      else if (onOffense && isPass && yards > 50) label = `${yards} yard pass`;
      else if (onOffense && isCatch && yards > 25) label = `${yards} yard catch`;
      else if (onOffense && isRush && yards > 25) label = `${yards} yard run`;
      return label ? [{ playId, favoriteKey: String(favorite.key), body: `${teamAbbr} ${label}: ${description}`, isPlayerAlert: false }] : [];
    });
  });
}
