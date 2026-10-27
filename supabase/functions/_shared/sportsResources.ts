function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validateSportsResource(path: string, payload: Record<string, unknown>, previous?: Record<string, unknown>): void {
  if (path.includes('scoreboard')) {
    if (!Array.isArray(payload.events) || payload.events.some((event) => {
      const row = object(event);
      return !/^\d+$/.test(String(row.id)) || typeof row.date !== 'string' || !Number.isFinite(Date.parse(row.date))
        || !Array.isArray(row.competitions) || !row.competitions.length;
    })) throw new Error('Invalid schedule response');
    if (!payload.events.length && Array.isArray(previous?.events) && previous.events.length) throw new Error('Empty refresh would erase a saved schedule');
  } else if (path.includes('/roster')) {
    if (!Array.isArray(payload.athletes)) throw new Error('Missing roster athletes');
    const players = payload.athletes.flatMap((entry) => Array.isArray(object(entry).items) ? object(entry).items as unknown[] : [entry]);
    if (!players.length || players.some((entry) => {
      const player = object(entry);
      return !/^\d+$/.test(String(player.id)) || typeof player.displayName !== 'string' || !player.displayName.trim();
    })) throw new Error('Empty or invalid roster response');
  } else {
    const sports = Array.isArray(payload.sports) ? payload.sports : [];
    const leagues = object(sports[0]).leagues;
    const teams = Array.isArray(leagues) ? object(leagues[0]).teams : null;
    const expected = path.startsWith('football/') ? 32 : 30;
    if (!Array.isArray(teams) || teams.length !== expected || new Set(teams.map((entry) => object(object(entry).team).id)).size !== expected
      || teams.some((entry) => !/^\d+$/.test(String(object(object(entry).team).id)))) throw new Error('Incomplete team directory response');
  }
}
