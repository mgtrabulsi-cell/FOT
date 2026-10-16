# GameWire

A responsive NFL hub with live scoreboards, weekly matchups, player statistics, and a favorite-centered feed called Your Locker Room.

## Run locally

Install Node.js 20 or newer, then run:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates a production build.

The VS Code task **Start GameWire dev server** is also configured for launching the app.

Desktop views use an 85% interface scale, with a compact matchup scoreboard and larger player names and headshots in The Wire, Stat Hub's player directory, and player cards. Stat Hub retains its extra player-area emphasis. Screens 760px wide or narrower keep the unscaled mobile layout.

Desktop account profiles have an additional 130% scale, larger text and form controls for readability, and single-column settings on narrower desktop screens. Mobile profile sizing is unchanged.

Locker Room uses an additional 120% desktop scale for easier reading, slightly less than the profile screen. Mobile Locker Room sizing is unchanged.

The original navy-blue theme uses bold crimson (`#cc2633`) for selection indicators, live accents, and Stat Hub chart bars. Filled red controls use a deeper crimson with white labels for readability; official team colors remain unchanged.

Player cards use slimmer per-game chart bars. Wide receiver and tight end cards include Targets in the draggable stat wheel, using ESPN's game box-score values and retaining unavailable values rather than estimating them.

The Wire omits the large page title, description, and normal feed-status label on desktop and mobile, keeping a compact date/week row immediately below navigation so games and stats appear sooner. Feed warnings remain visible.

On mobile, The Wire player box scores place each player's labeled stats on one compact horizontal row, with all stats visible without scrolling or wrapping into another row. Player identity stays above that row. The compact scoreboard uses stacked team rows with logos and names on the left and scores on the right. Stat Hub remains unchanged: its player-popup stat types retain a single horizontally scrollable, draggable row with touch-sized controls and a chart that fits the dialog width. The game selection wheels remain horizontally draggable.

The Wire's team/game search and Stat Hub's NFL player/team search open from a compact search icon in the top banner, with separate queries for each view. An indicator marks an active filter; the field has a clear action, and Escape closes it without removing the filter.

The Wire and Stat Hub game wheels both show color-coded TNF, SNF, and MNF badges for primetime games, identified by kickoff time in Eastern Time.

Favorite NFL teams keep the order set in **Locker Room → Following → Teams**. Use the up/down controls to reorder them; the top team’s matchup is featured when it is live, or when no other NFL game is live. Once that matchup is final, the next later primetime game in the selected week is featured.

Before kickoff, Player Box Score hides category filters and offers **Total stats** (default) and **Avg stats** below the Player Box Score/Team Comparison tabs. Live and final games restore All, Offense, Defense, and Special Teams, with unrestricted individual game box scores. Player Box Score omits the team-total row beneath every player group in all game states; Team Comparison is unchanged.

Pregame Player Box Score can show season-to-date totals or per-game averages for the selected team. Avg stats divides every statistic, including touchdowns and fumbles, by the player's games played (`GP`); GP itself remains a count. Missing totals or invalid GP remain unavailable. Switching modes does not fetch data again. Live and final box scores remain game-specific.

Desktop pregame tables share fixed column widths across passing, rushing, and receiving, aligning player names, games played, yards, and touchdowns vertically. Unused stat slots stay blank rather than implying a value; mobile hides those slots and keeps the labeled stat grids.

The final column shows QB interceptions (`INT`), rushing fumbles in Rushing, and receiving fumbles in Receiving (`FUM`), not fumbles lost. Missing fumble data remains unavailable. Player portraits retain ESPN's full-resolution images with top-centered framing and larger desktop headshots.

Pregame QB passing stats omit sacks per game. Live and final box scores retain the sacks reported by ESPN.

Select a player's name in The Wire's pregame Player Box Score to open the same player card as Stat Hub, with position-specific draggable stat tabs, recent-game charts, and a favorite toggle. Closing the card keeps the current matchup and team selection.

## Deploy to GitHub Pages

The [deployment workflow](.github/workflows/deploy.yml) builds and publishes the site on pushes to `main`, or when run manually. It uses Node.js 22, installs from the lockfile with `npm ci`, and gets the asset base path from GitHub Pages automatically. Local development keeps relative asset paths; project Pages uses `/FOT/`, while a configured custom domain uses its Pages base path.

1. In the GitHub repository, open **Settings → Pages** and select **GitHub Actions** as the build and deployment source.
2. For accounts and synced favorites, add these **repository secrets** under **Settings → Secrets and variables → Actions**:
   - `VITE_SUPABASE_URL`: your Supabase project URL.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: your public publishable key. Alternatively, use `VITE_SUPABASE_ANON_KEY` for the legacy anon key.
   - `VITE_VAPID_PUBLIC_KEY`: optional public VAPID key, if you configured mobile push notifications.
3. Complete the Supabase schema setup described below. In **Supabase → Authentication → URL Configuration**, set the production Site URL to `https://mgtrabulsi-cell.github.io/FOT/` and add that exact URL to the allowed redirect URLs. Keep `http://localhost:5173/` allowed for local development. If using a custom domain, use its URL instead.
4. Commit and push your changes to `main`. In **Actions**, watch **Deploy to GitHub Pages**, or select **Run workflow** to redeploy the committed version.
5. Open `https://mgtrabulsi-cell.github.io/FOT/` after deployment succeeds. Test sign-in, email confirmation/password reset, and mobile notifications if enabled.

GitHub Actions does not read your local `.env.local`; configure the repository secrets before deploying, and rebuild after changing them. Without Supabase configuration, guest browsing is available but accounts and synced favorites are not. Notifications additionally require the Supabase functions and scheduled poller described below; GitHub Pages only hosts the frontend.

Choosing **Continue as guest** loads the live scoreboard and stats without signing in, including when Supabase accounts are configured.

All `VITE_` values are public in the built JavaScript, even when supplied through GitHub secrets. Never put a Supabase service-role/secret key, private VAPID key, or cron secret in them. Local environment files remain gitignored.

To verify the project-path build locally in PowerShell:

```powershell
$env:VITE_BASE_PATH = '/FOT/'
npm run build
npm run preview -- --host 127.0.0.1
Remove-Item Env:VITE_BASE_PATH
```

Open `http://127.0.0.1:4173/FOT/`. Assets, the web app manifest, and the notification service worker stay within the deployed path. This static deployment does not require a Node.js server.

## Accounts and favorites

GameWire uses Supabase Auth for email/password accounts and stores each user's favorites in a row protected by row-level security.

1. Create a Supabase project and enable email authentication.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project API settings. The older `VITE_SUPABASE_ANON_KEY` variable is also supported.
3. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor to create the per-user favorites table and policies.
4. Set the Supabase Auth site URL and allowed redirect URLs to your local and deployed GameWire URLs.
5. Restart the Vite dev server.

Only a publishable or legacy anon key belongs in the frontend. Never expose a Supabase secret or service-role key.

Email/password signup is open with no application-imposed total-account cap. Signup email confirmation is disabled in [`supabase/config.toml`](supabase/config.toml), so creating an account signs the user in immediately without consuming the built-in email quota. This does not verify email ownership. Supabase abuse-protection rate limits and hosting/plan capacity still apply; these are not unlimited. Password-reset emails still use the configured email service and its quota. Configure production SMTP before relying on password recovery at scale or re-enabling confirmation. Apply the declared auth settings with `supabase config push` after reviewing its diff; avoid changing unrelated remote settings.

Locker Room **Latest updates** only shows team score checkpoints at completed quarters/overtime periods and at Final, not every scoring play or a mid-quarter snapshot. Quarter checkpoints use cumulative ESPN linescores, including scoreless quarters. If period data is unavailable, no quarter score is invented; final scores remain available. Existing granular score history is retained in storage but hidden from this feed. Latest plays, player-stat rows, live scoreboards, and push alert frequency are unchanged. Run `node --test scripts/locker-room-scores.test.mjs` to verify checkpoint generation.

### LIVEWIRE

Admins can attach up to four photos per post (JPG, PNG, WebP, or GIF; 5 MB each), preview/remove selections, and retain, replace, or remove photos while editing. Photos display in a responsive gallery and open full-size in a new tab. Titles and post text remain required. Apply the latest `supabase/livewire.sql` to create the public `livewire-photos` bucket, its admin-only upload policies, and the extended save RPC. Existing clients preserve attached photos when editing. Upload failures keep the draft and attempt cleanup of unused new files; cleanup failures are surfaced. Removed/published assets remain in storage for manual administrative cleanup to avoid breaking existing public links. Photos are public assets, not private uploads; do not upload sensitive content. Run `supabase db query --linked --file supabase/tests/livewire-photos.sql` for rollback-only attachment and upload-permission tests.

Admin posts have a required subject/title (up to 120 characters) above the 500-character body. The feed uses author initials, the public author name, a full local date/time, and a prominent headline, styled like Locker Room updates. Editing preserves both fields. Older untitled posts remain readable without an invented headline; editing them in the current interface requires adding a title. Apply the updated LIVEWIRE SQL before deploying this interface; the save RPC retains compatibility with older clients and preserves existing titles when an older client edits a post.

The top navigation includes a standalone public **LIVEWIRE** section between **Stat Hub** and **Locker Room**, separate from personal weekly history. Guests and members can read posts. Authorized admins can publish up to 500 characters with an optional HTTP/HTTPS news link and edit/delete their own posts. The owner can manage all posts and grant/revoke admin access for existing accounts by email using **Manage LIVEWIRE admins**. Verify intended admins' account identities out of band before granting access: signup does not verify email ownership. Posts refresh every 30 seconds, with older posts available through **Load older posts**. LIVEWIRE has no NFL week selector because this editorial feed is not filtered by week.

Apply [`supabase/livewire.sql`](supabase/livewire.sql) before deploying the frontend. A trusted database administrator must bootstrap the owner's `user_id`, `role = 'owner'`, and public `display_name` in `public.livewire_roles` after verifying the account identity. No owner is granted by signup, email entered in the browser, or editable account metadata. Role membership is private except to the owner; public posts store an author display name, not an email. Database privileges and security-definer RPCs enforce permissions even when the UI is bypassed. Revoking an admin prevents further writes immediately, while their published posts remain.

Run [`supabase/tests/livewire.sql`](supabase/tests/livewire.sql) through the SQL editor or `supabase db query --linked --file supabase/tests/livewire.sql` to verify guest/member access, posting validation, role escalation prevention, moderation ownership, and revocation. All test data is rolled back.

## Mobile push notifications

Profile shows a persistent **Notifications enabled** status when browser permission is granted and this device has a subscription saved for the signed-in account. It rechecks when returning to the tab/window; a failed status check is shown with Retry rather than claiming notifications are active.

LIVEWIRE notification links include the post ID (`#livewire/post/<id>`). The dispatcher sends an absolute production URL so older installed service workers retain the `/FOT/` path. Set the Edge Function secret `GAMEWIRE_SITE_URL` if moving to a different deployment (default: `https://mgtrabulsi-cell.github.io/FOT/`). The updated worker also normalizes legacy root-path alerts back into its own deployment scope and recovers LIVEWIRE post IDs from notification tags. It messages an existing app window instead of reloading it, preserving that window's signed-in session. A new window restores the normal saved session; if the user signed out, their session expired, or they disabled Remember this device and closed the tab, sign-in is still required and the post destination is retained. Linked posts are fetched even when older than the first feed page, scrolled into view, and highlighted; deleted posts show an unavailable message.

Game score/status and favorite-player play alerts use `#wire/game/<ESPN event ID>` and select that exact matchup on The Wire, clearing any game-search filter. The matchup is fetched directly from ESPN even if it belongs to a different week than the current game wheel. A failed lookup shows a Retry action rather than silently selecting another game. Legacy game/play notification tags also recover their matchup IDs. Test notifications open The Wire without a specific matchup.

Run `node --test scripts/notification-routing.test.mjs` to check post, game, player-play, and test notification routing for both new windows and existing signed-in windows.

Every newly published titled LIVEWIRE post queues a push to all devices with notifications enabled, independent of favorites or the score-alert checkbox. Its title is exactly `LIVEWIRE: <subject>` and its body is empty; the post text is not included. Edits do not send another notification, and old posts are not broadcast when this feature is installed. Tapping the alert opens the standalone LIVEWIRE section at the correct deployment base path. Browser/OS notification permission and delivery policies still apply.

After applying `livewire.sql`, deploy `send-livewire-push` and run [`supabase/livewire-notifications.sql`](supabase/livewire-notifications.sql). This uses the existing `gamewire-poll-url` and `gamewire-poll-secret` Vault entries and `GAMEWIRE_CRON_SECRET`/VAPID function secrets. The private delivery queue is processed every minute (typically the next minute after publishing), in batches of 100 with leased claims and retries for transient failures. Expired device subscriptions are removed. Delivery failures are recorded in `livewire_push_deliveries.last_error` and Edge Function logs. Push-provider acceptance is not a guarantee of device display; an interrupted send can be retried, with the post-specific notification tag replacing duplicate alerts where supported. Run [`supabase/tests/livewire-notifications.sql`](supabase/tests/livewire-notifications.sql) for rollback-only queue/permission tests.

Run `deno test --allow-env --allow-net supabase/functions/send-livewire-push/index.test.ts` to verify headline-only payloads, authorization, disabled-device handling, and retries against mocked providers (no real notifications are sent).

GameWire can send score and status changes for games involving a user's favorite teams or players. Push alerts require an HTTPS deployment; on iPhone, install GameWire from Safari's Share menu to the Home Screen before enabling notifications.

1. Re-run [`supabase/schema.sql`](supabase/schema.sql) in the connected Supabase project. It creates the per-device push subscription and private game-state tables.
2. Generate VAPID keys locally with `npm run generate:vapid`. This writes the public key to `.env.local` and private VAPID/cron values to the gitignored `.env.push-secrets.local`. Replace the `VAPID_CONTACT` placeholder in that private file with a real `mailto:` contact.
3. Sign in to the Supabase CLI locally with `npx supabase login`, then link the project with `npx supabase link --project-ref <project-ref>`.
4. Upload only server-side values with `npx supabase secrets set --env-file .env.push-secrets.local`. Never add the private VAPID key or cron secret to a `VITE_` variable.
5. Deploy with `npx supabase functions deploy send-test-push` and `npx supabase functions deploy poll-live-games`.
6. In Supabase Vault, create secrets named `gamewire-poll-url` (the deployed `poll-live-games` function URL) and `gamewire-poll-secret` (the same value as `GAMEWIRE_CRON_SECRET`). Enable `pg_cron`, `pg_net`, and Vault, then run [`supabase/notifications-cron.sql`](supabase/notifications-cron.sql) to poll once per minute.
7. Add `VITE_VAPID_PUBLIC_KEY` from `.env.local` to the hosting provider's environment variables, rebuild/redeploy, then sign in on a supported device, open Profile → Mobile notifications, enable notifications, and use **Send test notification**.

The score poller uses ESPN's undocumented public scoreboard feed, so alert timing and availability are not guaranteed. A licensed data source is recommended for production.

## Score coverage

The scoreboard is currently focused on the NFL. Scores refresh every 30 seconds. The **Current** week advances at noon every Tuesday in **America/New_York (Eastern Time)**, using ESPN's regular-season calendar, even if ESPN's default scoreboard still shows the previous week. Open pages pick up the rollover on their next refresh. Manual week selections stay on the selected week; choosing **Current** restores automatic rollover. Outside the regular season, the default ESPN week is retained.

Before kickoff, The Wire's Team Comparison shows both teams' season-to-date regular-season points, total yards, passing yards, and rushing yards per game, plus the corresponding points and yards allowed per game. These values come from ESPN's team season statistics, not projections or player-specific matchup averages. Missing values are shown as unavailable, and failed requests have a retry action. Once a game starts, Team Comparison shows that game's box-score statistics.

The pregame Player Box Score shows one active QB ranked by recent passing attempts in Passing, only the top two active RBs by season rushing yards in Rushing, and only the top six active WRs/TEs combined by season receiving yards in Receiving, when available. All active RB/WR/TE candidates are checked before ranking season totals; recent usage does not pre-limit these candidates. These are statistical rankings, not confirmed starters. Switching to Avg stats preserves the same players and ordering. Total stats uses totals for the selected team and year; Avg stats divides those totals by each player's GP. Career totals, other seasons, and other teams' records are excluded. Missing values stay unavailable; failed player requests are reported with a retry action, so rankings may be incomplete when requests fail. Pregame tables do not include team-total rows. After kickoff, these limits do not apply: all players and categories reported by ESPN's game box score are available, refreshed every 15 seconds during live games. Team Comparison continues to show season per-game averages before kickoff. Stat Hub is unchanged.

The NFL Players area uses a draggable game wheel, then groups players by position and recent usage. Each team shows one usage-ranked QB, two RBs, one TE, and up to four WRs when those players have recent box-score usage. ESPN's public roster marks active status but does not provide an official depth chart, so starting roles are inferred from recent box-score participation.

Selecting an NFL game also opens team player lists and a trends view with the feed's current spread, total, moneyline, team scoring averages, and recent results. Selecting any listed player opens a game-by-game chart for their last five games with a draggable, scrollbar-free horizontal stat selector tailored to position: quarterbacks get passing stats, running backs get rushing and receiving stats, and receivers/tight ends get receiving stats. Values absent from a game feed are shown as unavailable. ATS history is displayed only when the feed includes it; this source currently omits those records for some matchups. The app presents information, not betting picks.

The ESPN feeds used here are public, undocumented endpoints with no availability or latency guarantee. For a production launch, use a licensed sports-data provider and confirm its coverage, terms, and update guarantees.

## Favorites and Your Locker Room

Run [`supabase/locker-room-history.sql`](supabase/locker-room-history.sql) once in the connected Supabase project's SQL editor (or with `supabase db query --linked --file supabase/locker-room-history.sql`). It adds account-isolated weekly history and an authenticated save function. The configured project has this migration applied.

Database regression checks are in [`supabase/tests/locker-room-history.sql`](supabase/tests/locker-room-history.sql). Run them with `supabase db query --linked --file supabase/tests/locker-room-history.sql`; all test users and rows are rolled back.

Locker Room follows the main NFL week selector. Collected score changes, matching headlines, big plays, and player game-stat snapshots are archived by account, season, and NFL week, with no Tuesday deletion of the archive. Signed-in history follows the account across devices; guests keep browser-only history. Player snapshots retain the player's identity even if they are later unfavorited. Save/load failures are visible with a retry action, not a silent browser-only fallback for accounts.

The Following > Players section shows a compact game-stat row: WR/TE receptions/targets, receiving yards and receiving TD; RB rushes, rushing yards and rushing TD; QB completions/attempts, passing yards, passing TD and interceptions. Live stats refresh every 15 seconds while the site is open; completed-game stats remain saved and are labeled FINAL. Returning to a previous week loads its saved activity and can retrieve available final ESPN stats and qualifying plays for current favorites. Older headlines and score-change sequences deleted before this feature cannot be reconstructed; past final scores and ESPN plays are not a complete replay of deleted updates. Missing feed values remain unavailable rather than being filled with zero. Loading and refresh failures are shown explicitly. Pregame games do not show a game-stat row.

Favorite a team from its game center or a player from their stats popup. Once signed in, favorites are saved to that user's Supabase account. Your Locker Room combines ESPN headlines matched to favorite names with score/status changes and big-play alerts for favorited NFL players. Scoreboards poll every 30 seconds, latest plays every 15 seconds during relevant live games, and news every five minutes. ESPN public feeds have no availability guarantee.