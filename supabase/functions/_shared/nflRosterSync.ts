// Builds the NFL roster bridge: ESPN athletes (canonical for status and identity)
// matched to API-Sports player IDs by normalized name. Pure and Node-testable.

export type NFLRosterRow = {
  sport: 'NFL';
  season: number;
  espn_team_id: string;
  api_team_id: string;
  espn_player_id: string;
  api_player_id: string | null;
  name: string;
  position: string;
  jersey: string;
  active: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

const nameSuffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function normalizePlayerName(name: string): string {
  const words = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 2 && nameSuffixes.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

// Mirrors the client's roster availability rules so served rosters never list
// practice-squad, reserve, suspended or ruled-out players as active.
function isInjuryInactive(status: string, desc: string, name: string, abbr: string): boolean {
  return /^(out|injured reserve|ir|suspension|suspended|reserve-ret|doubtful)$/i.test(status)
    || /out|injured reserve|ir|suspension/i.test(desc)
    || /out|injured_reserve|ir|suspension/i.test(name)
    || abbr.toLowerCase() === 'o' || abbr.toLowerCase() === 'ir';
}

function isActiveESPNAthlete(player: Record<string, unknown>): boolean {
  const statusObj = record(player.status);
  const statusType = text(statusObj.type).toLowerCase();
  const statusName = text(statusObj.name).toLowerCase();
  if (statusType === 'practice-squad' || statusType === 'injured-reserve' || statusType === 'ir'
    || statusType === 'suspended' || statusName.includes('reserve') || statusName.includes('practice')) return false;
  if (statusType && statusType !== 'active' && statusType !== 'day-to-day') return false;
  const injuries = Array.isArray(player.injuries) ? player.injuries : [];
  return !injuries.some((value) => {
    const injury = record(value), type = record(injury.type);
    return isInjuryInactive(text(injury.status), text(type.description), text(type.name), text(type.abbreviation));
  });
}

export function matchNFLRoster(
  season: number,
  espnTeamId: string,
  apiTeamId: string,
  espnRosterPayload: unknown,
  apiPlayersPayload: unknown,
): NFLRosterRow[] {
  const espnAthletes = (Array.isArray(record(espnRosterPayload).athletes) ? record(espnRosterPayload).athletes as unknown[] : [])
    .flatMap((group) => {
      const entry = record(group);
      return Array.isArray(entry.items) ? entry.items : [group];
    }).map(record).filter((player) => text(player.id) && (text(player.displayName) || text(player.fullName)));
  if (!espnAthletes.length) throw new Error('The shared ESPN roster is empty; refusing to overwrite the bridge.');
  const apiPlayers = (Array.isArray(record(apiPlayersPayload).response) ? record(apiPlayersPayload).response as unknown[] : [])
    .map(record).filter((player) => text(player.id) && text(player.name));
  // Only names that appear exactly once on each side can be bridged safely.
  const counts = new Map<string, number>();
  for (const player of apiPlayers) {
    const key = normalizePlayerName(text(player.name));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const apiByName = new Map<string, string>();
  for (const player of apiPlayers) {
    const key = normalizePlayerName(text(player.name));
    if (counts.get(key) === 1) apiByName.set(key, text(player.id));
  }
  const seen = new Map<string, number>();
  for (const player of espnAthletes) {
    const key = normalizePlayerName(text(player.displayName) || text(player.fullName));
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return espnAthletes.map((player) => {
    const name = text(player.displayName) || text(player.fullName);
    const key = normalizePlayerName(name);
    return {
      sport: 'NFL' as const, season,
      espn_team_id: espnTeamId, api_team_id: apiTeamId,
      espn_player_id: text(player.id),
      api_player_id: seen.get(key) === 1 ? apiByName.get(key) ?? null : null,
      name,
      position: text(record(player.position).abbreviation).toUpperCase(),
      jersey: text(player.jersey),
      active: isActiveESPNAthlete(player),
    };
  });
}
