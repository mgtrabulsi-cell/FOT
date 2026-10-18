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
  const possessionTeamId = teamIds.includes(teamId) ? teamId : null;
  return possessionTeamId || fieldPosition || downDistance ? { possessionTeamId, fieldPosition, downDistance } : undefined;
}

export function nflFieldPosition(situation: NFLSituation | undefined): string {
  if (!situation?.fieldPosition) return 'Field position unavailable';
  return [situation.downDistance, `Ball at ${situation.fieldPosition}`].filter(Boolean).join(' · ');
}
