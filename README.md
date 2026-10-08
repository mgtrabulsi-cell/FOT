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

## Accounts and favorites

GameWire uses Supabase Auth for email/password accounts and stores each user's favorites in a row protected by row-level security.

1. Create a Supabase project and enable email authentication.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project API settings. The older `VITE_SUPABASE_ANON_KEY` variable is also supported.
3. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor to create the per-user favorites table and policies.
4. Set the Supabase Auth site URL and allowed redirect URLs to your local and deployed GameWire URLs.
5. Restart the Vite dev server.

Only a publishable or legacy anon key belongs in the frontend. Never expose a Supabase secret or service-role key. Email confirmation behavior is controlled by the Supabase project's Auth settings.

## Mobile push notifications

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

The scoreboard is currently focused on the NFL. Scores refresh every 30 seconds, and the week selector follows ESPN's current week or loads a selected regular-season week.

The NFL Players area uses a draggable game wheel, then groups players by position and recent usage. Each team shows one usage-ranked QB, two RBs, one TE, and up to four WRs when those players have recent box-score usage. ESPN's public roster marks active status but does not provide an official depth chart, so starting roles are inferred from recent box-score participation.

Selecting an NFL game also opens team player lists and a trends view with the feed's current spread, total, moneyline, team scoring averages, and recent results. Selecting any listed player opens a game-by-game chart for their last five games with a draggable, scrollbar-free horizontal stat selector tailored to position: quarterbacks get passing stats, running backs get rushing and receiving stats, and receivers/tight ends get receiving stats. Values absent from a game feed are shown as unavailable. ATS history is displayed only when the feed includes it; this source currently omits those records for some matchups. The app presents information, not betting picks.

The ESPN feeds used here are public, undocumented endpoints with no availability or latency guarantee. For a production launch, use a licensed sports-data provider and confirm its coverage, terms, and update guarantees.

## Favorites and Your Locker Room

Favorite a team from its game center or a player from their stats popup. Once signed in, favorites are saved to that user's Supabase account. Your Locker Room combines ESPN headlines matched to favorite names with score/status changes and big-play alerts for favorited NFL players. Scoreboards poll every 30 seconds, latest plays every 15 seconds during relevant live games, and news every five minutes. ESPN public feeds have no availability guarantee.