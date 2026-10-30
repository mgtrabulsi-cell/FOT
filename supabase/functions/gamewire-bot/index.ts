import { createClient } from 'npm:@supabase/supabase-js@2';
import { array, normalize, numeric, object, pickBlurb, text } from '../_shared/gamewaire.ts';
import type { Candidate } from '../_shared/gamewaire.ts';
import { defensiveStandings, publicJSON } from '../_shared/gamewaireSources.ts';
import { applyBotEditorial, botMatchup, buildBotReport, readBotPositions, readBotRoster, readBotWeek } from '../_shared/gamewireBot.ts';
import { collectBotProjections } from '../_shared/gamewireBotProjections.ts';
import type { BotDirectory, BotFormat, BotProp, BotReport } from '../_shared/gamewireBot.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
type Environment = { get: (name: string) => string | undefined };
const site = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const propLabels: Record<string, string> = { player_pass_yds: 'passing yards', player_rush_yds: 'rushing yards', player_reception_yds: 'receiving yards', player_receptions: 'receptions' };
export async function handleGamewireBot(request: Request, env: Environment, fetcher: typeof fetch = fetch) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST for the GameWire Bot.' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to use the GameWire Bot preview.' }, 401);
  const url = env.get('SUPABASE_URL'), anon = env.get('SUPABASE_ANON_KEY'), service = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Bot account services are not configured.' }, 503);
  const client = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  try {
    const user = await client.auth.getUser();
    if (user.error || !user.data.user) return json({ error: 'Your session expired. Sign in again.' }, 401);
    const permission = await client.rpc('gamewaire_can_admin');
    if (permission.error) throw new Error('Could not verify bot preview access.');
    if (permission.data !== true) return json({ error: 'GameWire Bot is currently an owner-only preview.' }, 403);
    let raw: unknown;
    try { raw = await request.json(); } catch { return json({ error: 'Invalid bot request.' }, 400); }
    const input = object(raw);
    if (input.action !== 'directory' && input.action !== 'breakdown') return json({ error: 'Choose player search or a player breakdown.' }, 400);
    if (input.action === 'breakdown' && (!/^\d{1,12}$/.test(text(input.playerId)) || !['ppr', 'half', 'standard'].includes(text(input.format))))
      return json({ error: 'Choose an NFL player and a supported scoring format.' }, 400);
    let claimed = false;
    const claim = async () => {
      if (claimed) return true;
      const result = await admin.rpc('gamewire_bot_claim', { target_user: user.data.user!.id });
      if (result.error) throw new Error('Could not check the bot preview request limit.');
      claimed = result.data === true; return claimed;
    };
    const cached = async <T>(key: string, milliseconds: number | ((data: T) => number), load: () => Promise<T>): Promise<{ data: T; cached: boolean }> => {
      const now = new Date();
      const saved = await admin.from('gamewire_bot_cache').select('payload').eq('cache_key', key).gt('expires_at', now.toISOString()).maybeSingle();
      if (saved.error) throw new Error('Could not read the verified bot cache.');
      if (saved.data) return { data: saved.data.payload as T, cached: true };
      if (!await claim()) throw new Error('Bot preview refresh limit reached (60 per hour). Cached breakdowns remain available; retry after the hour changes.');
      const data = await load();
      const ttl = typeof milliseconds === 'function' ? milliseconds(data) : milliseconds;
      const written = await admin.from('gamewire_bot_cache').upsert({ cache_key: key, payload: data, expires_at: new Date(Date.now() + ttl).toISOString() });
      if (written.error) throw new Error('Could not save the verified bot response. Retry rather than use an untracked snapshot.');
      return { data, cached: false };
    };
    const feedWarnings: string[] = [];
    const criticalFeed = async (path: string, label: string) => {
      try { return await publicJSON(`${site}/${path}`, fetcher); }
      catch (primary) {
        console.error('Bot primary public ESPN feed unavailable', label, primary);
        try {
          const value = await publicJSON(`${site.replace('site.api.', 'site.web.api.')}/${path}`, fetcher);
          if (!feedWarnings.length) feedWarnings.push('Some NFL sources could not refresh from the primary ESPN host; verified data was loaded from ESPN’s equivalent public feed.');
          return value;
        } catch (secondary) {
          console.error('Bot alternate public ESPN feed unavailable', label, secondary);
          throw new Error(`${label} is unavailable from ESPN. ${secondary instanceof Error ? secondary.message : 'Retry the verified-data preview.'}`);
        }
      }
    };
    const board = (await cached('nfl:week:v1', 60_000, () => criticalFeed('scoreboard', 'Current NFL week'))).data;
    const week = readBotWeek(board);
    const directory = await cached<BotDirectory>(`nfl:directory:v2:${week.season}`, 15 * 60_000, async () => {
      const raw = object(await criticalFeed('teams?limit=100', 'NFL team directory'));
      const league = object(array(object(array(raw.sports)[0]).leagues)[0]);
      const teams = array(league.teams).map((row) => {
        const team = object(object(row).team); return { id: text(team.id), name: text(team.displayName), abbr: text(team.abbreviation) };
      });
      if (teams.length !== 32 || teams.some((team) => !/^\d{1,2}$/.test(team.id) || !team.name || !team.abbr)) throw new Error('The NFL team directory is incomplete.');
      const players: BotDirectory['players'] = [], positions: Record<string, string> = {}, warnings: string[] = [];
      for (let start = 0; start < teams.length; start += 8) await Promise.all(teams.slice(start, start + 8).map(async (team) => {
        try {
          const roster = await criticalFeed(`teams/${team.id}/roster?season=${week.season}`, `${team.abbr} roster`);
          players.push(...readBotRoster(roster, team)); Object.assign(positions, readBotPositions(roster));
        }
        catch (cause) {
          console.error('Bot roster unavailable', team.id, cause);
          warnings.push(`${team.abbr} player search unavailable: ${cause instanceof Error ? cause.message : 'Roster failed.'}`);
        }
      }));
      if (!players.length) throw new Error('No verified NFL players could be loaded. Retry search.');
      return { ...week, players: [...new Map(players.map((row) => [row.id, row])).values()].sort((a, b) => a.name.localeCompare(b.name)),
        positions, warnings: [...warnings, ...feedWarnings], checkedAt: new Date().toISOString() };
    });
    if (input.action === 'directory') return json({ ...directory.data, ...week, warnings: [...new Set([...directory.data.warnings, ...feedWarnings])], cached: directory.cached, mode: 'verified-preview', aiEnabled: false });
    const player = directory.data.players.find((row) => row.id === input.playerId);
    if (!player) return json({ error: 'This player is not in the current verified NFL directory. Retry player search.' }, 404);
    const format = input.format as BotFormat, matchup = botMatchup(board, player);
    const cacheKey = `nfl:breakdown:v5:${week.season}:${week.week}:${week.seasonType}:${player.teamId}:${player.id}:${format}:${matchup?.eventId ?? 'no-game'}:${matchup?.state ?? 'none'}:${matchup?.start ?? ''}`;
    const result = await cached<BotReport>(cacheKey, (report) => report.dataIssues.length ? 30_000 : 5 * 60_000, async () => {
      const [roster, logs] = await Promise.allSettled([
        criticalFeed(`teams/${player.teamId}/roster?season=${week.season}`, 'Current player roster'),
        publicJSON(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.id}/gamelog?season=${week.season}`, fetcher),
      ]);
      const report = buildBotReport(player, roster.status === 'fulfilled' ? roster.value : null, logs.status === 'fulfilled' ? logs.value : null, board, format, Date.now());
      for (const [label, result] of [['Current roster', roster], ['Player game logs', logs]] as const) {
        if (result.status === 'rejected') {
          console.error('Bot source unavailable', label, player.id, result.reason);
          report.dataIssues.push(`${label}: ${result.reason instanceof Error ? result.reason.message : 'Provider request failed.'}`);
        }
      }
      const get = async (url: string) => (await cached(`nfl:projection-source:v1:${url}`, url.includes('/summary?') ? 24 * 3600000 : 15 * 60_000,
        () => url.startsWith(`${site}/`) ? criticalFeed(url.slice(site.length + 1), 'NFL matchup sample') : publicJSON(url, fetcher))).data;
      const loadProjections = async () => {
        if (!report.eligibleForGuidance) return;
        report.projections = await collectBotProjections(player, matchup, week.season, logs.status === 'fulfilled' ? logs.value : null, directory.data, get, Date.now());
        if (report.projections.some((projection) => projection.estimate === null)) report.dataIssues.push('Some estimates are unavailable because recent verified data is incomplete.');
      };
      const loadOpponent = async () => {
        if (!report.matchup) return;
        try {
          const stats = defensiveStandings(await publicJSON(`https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?season=${week.season}&type=0&level=2`, fetcher), 'NFL', week.season, report.checkedAt);
          const opponent = [...stats.values()].find((row) => row.teamId === report.matchup!.opponentId);
          if (!opponent || opponent.games < 3) throw new Error('The opponent has insufficient recorded standings data.');
          report.matchupText = `${opponent.team} rank ${opponent.rank} of ${opponent.leagueSize}${opponent.tied ? ' (tied)' : ''} in scoring defense, allowing ${opponent.pointsAllowed.toFixed(1)} points per game across ${opponent.games} games. This is team scoring defense, not a position-specific fantasy or yardage ranking.`;
        } catch (cause) {
          console.error('Bot opponent context unavailable', cause);
          report.warnings.push(`Matchup ranking unavailable: ${cause instanceof Error ? cause.message : 'ESPN data failed.'}`);
        }
      };
      await Promise.all([loadProjections(), loadOpponent()]);
      return report;
    });
    const [graphics, rankings] = await Promise.all([
      admin.from('fantasy_graphics').select('id,published_content,updated_at').eq('season', week.season).eq('week', week.week).not('published_content', 'is', null),
      admin.from('gamewire_fantasy_rankings').select('player_id,team_id,player_name,position,rank,scoring_format,published_at')
        .eq('season', week.season).eq('week', week.week).eq('scoring_format', format).eq('position', player.position).eq('player_id', player.id),
    ]);
    if (graphics.error || rankings.error) throw new Error('Could not verify this week’s published Start/Sit graphics and rankings. Retry.');
    const report = applyBotEditorial({ ...result.data, warnings: [...new Set([...result.data.warnings, ...directory.data.warnings, ...feedWarnings])] }, graphics.data, rankings.data);
    // Lock status is rechecked even when the five-minute workload snapshot is reused.
    if (matchup && (matchup.state !== 'pre' || Date.parse(matchup.start) <= Date.now())) {
      report.indication = 'Game locked'; report.summary = 'This week’s game has started or finished. Saved workload is historical, not a pregame recommendation.';
    }
    if (matchup && report.indication !== 'Game locked') {
      const start = new Date(Date.parse(matchup.start) - 6 * 3600000).toISOString(), end = new Date(Date.parse(matchup.start) + 6 * 3600000).toISOString();
      const publications = await admin.from('gamewaire_publications').select('picks,event_start').eq('sport', 'NFL').gte('event_start', start).lte('event_start', end).limit(30);
      if (publications.error) throw new Error('Could not verify published prop coverage. Retry the player breakdown.');
      const props: BotProp[] = [];
      for (const row of publications.data ?? []) for (const raw of array(row.picks)) {
        const pick = object(raw);
        const price = numeric(pick.american);
        if (!propLabels[text(pick.market)] || object(pick.identifiers).playerId !== player.id || object(pick.identifiers).espnEventId !== matchup.eventId
          || normalize(text(pick.subject)) !== normalize(player.name) || price === undefined || !Number.isInteger(price) || price < -200 || Math.abs(price) < 100) continue;
        if (!['Over', 'Under'].includes(text(pick.side)) || numeric(pick.line) === undefined || !Array.isArray(pick.samples)
          || !text(pick.book) || !Number.isFinite(Date.parse(text(pick.updatedAt)))) throw new Error('Published player prop data is incomplete.');
        props.push({ selection: `${pick.subject} ${pick.side} ${pick.line} ${propLabels[text(pick.market)]}`,
          american: Number(pick.american), book: text(pick.book), savedAt: text(pick.updatedAt), breakdown: pickBlurb(raw as Candidate) });
      }
      report.props = [...new Map(props.map((prop) => [prop.selection, prop])).values()].slice(0, 4);
      if (report.props.length) report.propNote = 'Published GamewAIre snapshots only, not current sportsbook prices. Sportsbook lines may vary. No live odds were requested.';
    }
    return json({ report, cached: result.cached, partial: report.dataIssues.length > 0, mode: 'verified-preview', aiEnabled: false }, report.dataIssues.length ? 206 : 200);
  } catch (cause) {
    console.error('GameWire Bot preview failed', cause);
    const error = cause instanceof Error ? cause.message : 'The bot preview could not load verified data. Retry.';
    return json({ error }, error.includes('limit reached') ? 429 : 502);
  }
}
if (import.meta.main) Deno.serve((request) => handleGamewireBot(request, Deno.env));
