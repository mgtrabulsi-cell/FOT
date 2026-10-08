# Fieldhouse Workspace Guidance

Fieldhouse is a React, TypeScript, and Vite sports hub. Keep the scoreboard and player-stat workflows responsive and accessible. Scoreboards use ESPN public feeds polled every 30 seconds. Team/player favorites persist locally; The Den combines name-matched ESPN news with score/status changes. The standalone NFL Players area uses a draggable game wheel and shows one usage-ranked QB, RB, and TE plus two to four WRs per team when available. ESPN's public roster does not provide an official depth chart, so do not present usage-ranked choices as confirmed starters. Do not label usage as a fantasy projection, invent missing player or ATS data, or present odds as recommendations. NFL matchup panels show face/name-only players with draggable, position-specific game-stat tabs and per-game charts. Player profile averages and recent-game logs remain local demonstration data.

## Setup Status

- [x] Workspace requirements clarified
- [x] React/Vite project scaffolded
- [x] Live scoreboards, soccer match details, and NFL analysis implemented
- [x] No additional VS Code extensions required
- [x] Dependencies installed and production build verified
- [x] VS Code dev task created and development server launched
- [x] README and workspace guidance documented

## Local Development

Install Node.js 20 or newer, run `npm install`, then `npm run dev`. Use `npm run build` to verify a production build.
