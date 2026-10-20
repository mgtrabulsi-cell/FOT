export type NFLSituation = {
  possessionTeamId: string | null;
  fieldPosition: string | null;
  downDistance: string | null;
  playHighlight?: NFLPlayHighlight;
  lastPlay?: NFLLastPlay;
};

export type NFLLastPlay = {
  id: string | null;
  text: string;
  type: string | null;
  teamId: string | null;
  yards: number | null;
  scoreValue: number;
  drive: string | null;
};

export type NFLPlayHighlight = 'TOUCHDOWN' | 'FIELD_GOAL' | 'KICKOFF';

function readLastPlay(value: object, teamIds: string[]): NFLLastPlay | undefined {
  const play: unknown = Reflect.get(value, 'lastPlay');
  if (!play || typeof play !== 'object') return undefined;
  const str = (entry: unknown) => (typeof entry === 'string' ? entry.trim() : '');
  const sub = (key: string, inner: string) => {
    const parent: unknown = Reflect.get(play, key);
    return parent && typeof parent === 'object' ? Reflect.get(parent, inner) : undefined;
  };
  const text = str(Reflect.get(play, 'text')).replace(/\s+/g, ' ');
  if (!text) return undefined;
  const rawId: unknown = Reflect.get(play, 'id');
  const rawTeam = sub('team', 'id');
  const teamId = typeof rawTeam === 'string' || typeof rawTeam === 'number' ? String(rawTeam) : '';
  const yards: unknown = Reflect.get(play, 'statYardage');
  const score: unknown = Reflect.get(play, 'scoreValue');
  return {
    id: typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null,
    text,
    type: str(sub('type', 'text')) || null,
    teamId: teamIds.includes(teamId) ? teamId : null,
    yards: typeof yards === 'number' && Number.isFinite(yards) ? yards : null,
    scoreValue: typeof score === 'number' && Number.isFinite(score) ? score : 0,
    drive: str(sub('drive', 'description')) || null,
  };
}

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
  const playHighlight = fieldPosition ? null : lastPlayHighlight(value);
  const lastPlay = readLastPlay(value, teamIds);
  if (!possessionTeamId && !fieldPosition && !downDistance && !playHighlight && !lastPlay) return undefined;
  return {
    possessionTeamId, fieldPosition, downDistance,
    ...(playHighlight ? { playHighlight } : {}),
    ...(lastPlay ? { lastPlay } : {}),
  };
}

// Between a score/kickoff and the next snap ESPN drops the ball spot; the last play tells us what just happened.
// Extra points and two-point tries still belong to the touchdown celebration; kickoff returns that score are touchdowns.
function lastPlayHighlight(value: object): NFLPlayHighlight | null {
  const lastPlay: unknown = Reflect.get(value, 'lastPlay');
  if (!lastPlay || typeof lastPlay !== 'object') return null;
  const type: unknown = Reflect.get(lastPlay, 'type');
  const typeText = type && typeof type === 'object' ? Reflect.get(type, 'text') : '';
  const label = typeof typeText === 'string' ? typeText : '';
  if (/touchdown|extra point|two-point|2pt/i.test(label)) return 'TOUCHDOWN';
  if (/field goal/i.test(label)) return /good/i.test(label) ? 'FIELD_GOAL' : null;
  if (/kickoff|kick off|end of half|halftime|end of regulation/i.test(label)) return 'KICKOFF';
  const scoreValue = Reflect.get(lastPlay, 'scoreValue');
  if (scoreValue === 6) return 'TOUCHDOWN';
  if (scoreValue === 3) return 'FIELD_GOAL';
  return null;
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
  if (!situation?.fieldPosition) {
    if (situation?.playHighlight === 'TOUCHDOWN') return 'TOUCHDOWN!';
    if (situation?.playHighlight === 'FIELD_GOAL') return 'FIELD GOAL';
    if (situation?.playHighlight === 'KICKOFF') return 'Kickoff';
    return 'Field position unavailable';
  }
  return [situation.downDistance, `Ball at ${situation.fieldPosition}`].filter(Boolean).join(' · ');
}
