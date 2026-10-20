export type NFLSituation = {
  possessionTeamId: string | null;
  fieldPosition: string | null;
  downDistance: string | null;
};

export function readNFLSituation(value: unknown, teamIds: string[]): NFLSituation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const read = (key: string) => {
    const entry: unknown = Reflect.get(value, key);
    return typeof entry === 'string' ? entry.trim() : '';
  };
  const possession = Reflect.get(value, 'possession');
  const teamId = typeof possession === 'string' || (typeof possession === 'number' && Number.isInteger(possession))
    ? String(possession) : '';
  const full = read('downDistanceText');
  const fieldPosition = read('possessionText') || full.match(/\bat\s+(.+)$/i)?.[1]?.trim() || null;
  const downDistance = read('shortDownDistanceText') || full.replace(/\s+at\s+.+$/i, '').trim() || null;
  const possessionTeamId = teamIds.includes(teamId) ? teamId : lastPlayPossession(value, teamIds);
  return possessionTeamId || fieldPosition || downDistance ? { possessionTeamId, fieldPosition, downDistance } : undefined;
}

// ESPN sometimes omits `possession` (often right after kickoffs) while a down is set. The last play's team is
// only trusted for plays that keep the ball with that team; ambiguous changes of possession show no football.
function lastPlayPossession(value: object, teamIds: string[]): string | null {
  const down = Reflect.get(value, 'down');
  if (typeof down !== 'number' || down < 1 || down > 4) return null;
  const lastPlay: unknown = Reflect.get(value, 'lastPlay');
  if (!lastPlay || typeof lastPlay !== 'object') return null;
  const type: unknown = Reflect.get(lastPlay, 'type');
  const typeText = type && typeof type === 'object' ? Reflect.get(type, 'text') : '';
  if (typeof typeText !== 'string' || !typeText
    || /punt|interception|fumble|turnover|safety|touchdown|field goal|extra point|two-point|end of|timeout|blocked|penalty/i.test(typeText)) return null;
  const team: unknown = Reflect.get(lastPlay, 'team');
  const id = team && typeof team === 'object' ? Reflect.get(team, 'id') : undefined;
  const teamId = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
  return teamIds.includes(teamId) ? teamId : null;
}

export function nflFieldPosition(situation: NFLSituation | undefined): string {
  if (!situation?.fieldPosition) return 'Field position unavailable';
  return [situation.downDistance, `Ball at ${situation.fieldPosition}`].filter(Boolean).join(' · ');
}
