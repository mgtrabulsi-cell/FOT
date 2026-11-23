# GameWire: App Store review response and metadata

This is a draft for the app owner. Verify every statement against the submitted Median build before sending. Website changes alone do not guarantee approval under 4.2, 4.2.6 or 4.3. Apple asked for a reply first; do not blindly resubmit the same binary.

## Before sending

- Confirm the reviewed Median build actually loads the updated GameWire experience. Record the app version/build and iOS version tested. Rebuild through Median if native configuration, bundled resources or the submitted binary need updating.
- Confirm whether beta testing used TestFlight, web access, Median builds or a combination; add dates and duration. The owner confirmed 30+ testers, not the distribution method.
- Check the beta examples below against actual feedback records. Do not invent quotes, dates, tester identities or outcomes.
- Confirm that no client, partner or purchased content/template was involved beyond the disclosed Median service. Ownership and direct submission were affirmed, but these additional details need explicit confirmation.
- Verify commercial content permissions and attribution requirements for ESPN, API-Sports and every other provider used in the submitted app. Public availability is not proof of licensing. Do not describe third-party sports data as exclusively owned by GameWire.
- Provide working reviewer credentials through App Store Connect's private review fields if sign-in is needed. Do not put credentials in this document. Keep the account available and ensure review access does not depend on administrator privileges.
- Capture an iPhone screen recording: find player, save forecast and note, reopen it from Locker Room, edit note, and compare a finished game's checked final with the original snapshot. Include screenshots and real feedback examples where available.

## Draft reply to App Review

Thank you for the detailed feedback. We understand that cosmetic changes or a website wrapper alone are not sufficient. The following explains GameWire's purpose, ownership, technology and testing. We have also added a connected personal-research workflow rather than another scores-only screen. We would appreciate your assessment of this information before any further submission.

### 1. What the app does and the problem it solves

GameWire is an NFL and NBA research companion for following a question from before a game through its recorded outcome. Users can inspect player statistics, recent appearances, matchup context and GamewAIre model estimates, then save the displayed player or matchup research with their own notes in My Game Plan.

The saved research is a fixed snapshot. Subsequent model updates do not overwrite what the user originally saw. After the game, the user can check verified final box scores and retain those separately beside the original research, update personal notes, and search their research history. Saved research and previously checked results remain readable on the same device without downloading the data again once the app shell is available.

The primary problem is maintaining continuity in sports research: what the user expected, why they expected it, and what actually happened. Live scores, searchable player records and favorites support that workflow rather than being its only purpose. Forecasts are labeled estimates, not guaranteed outcomes or betting recommendations.

### 2. Intended users

The intended audience is NFL and NBA fans who actively study players and matchups rather than only checking scores. This includes fantasy-sports participants researching player usage and recent form, and fans who want to keep a personal record of their reasoning and revisit it after games. The app does not require placing a wager to use its research features.

### 3. Need or gap addressed

GameWire combines player discovery, recent statistical context, modeled matchup research, a user-written research notebook, and postgame comparison in one connected workflow across NFL and NBA.

The distinction we ask reviewers to evaluate is the ability to preserve the original displayed forecast with its available timestamp/model identity and personal reasoning, then review verified outcomes without silently replacing the original with a newer prediction. This makes the product a personal research workspace, not simply another live-score list or a marketing website.

We are not claiming that no other sports app offers notes, predictions or offline content. Our differentiation is this particular integrated before-and-after research experience and the original GameWire presentation and analysis built around it.

### 4. Beta testing and feedback applied

More than 30 people participated in beta testing. Their feedback informed changes to player search, game simulations, notification options and box-score presentation.

Examples to substantiate with the owner's feedback records before sending:

- Player search: make players easier to find; the current shared NFL/NBA search supports first names, surnames and partial names.
- Game simulations: make matchup estimates and player projections easier to inspect; GameWire presents matchup forecasts and player-level estimates with unavailable data explicitly labeled.
- Notifications: provide different notification choices instead of a single undifferentiated experience; verify the exact options present in the submitted build.
- Box scores: make player statistics easier to read; mobile layouts use compact, scrollable statistical tables while retaining reported values.

Testing distribution method: **[owner: TestFlight / web / Median builds / combination]**.
Testing dates and duration: **[owner: enter actual dates and duration]**.
Attach representative feedback and describe the actual corresponding production changes. Do not present the new My Game Plan feature as beta-tested until it has itself been tested.

### 5. Standalone app or suite

GameWire is intended as a standalone product. There are no other apps on our developer account, so it is not one of multiple near-identical sport, team or branding variants.

### 6. Why not consolidate into another existing app

There is no other app on our developer account into which this functionality could be consolidated. NFL and NBA experiences are already combined within this single GameWire app.

### 7. Code, frameworks or assets shared with other apps on the account

There are no other apps on our developer account with which GameWire shares application code or assets. GameWire uses standard third-party technologies and a Median iPhone wrapper, disclosed below. We are not claiming the entire binary is written from scratch or entirely native.

### 8. Third-party codebase, SDK or content library

The submitted iPhone app uses Median to deliver the GameWire experience. Median is a third-party app-wrapper service, not the owner or submitter of GameWire's content. The web application is built using standard React, TypeScript and Vite technologies and Supabase services. The repository also contains Capacitor integration; include Capacitor in the submitted-binary disclosure only if it is actually shipped in the reviewed Median binary.

Sports information is obtained through third-party providers, including ESPN and API-Sports where used. These are shared sports-data sources, not exclusive GameWire-owned league data.

The original functionality layered on these technologies includes the GameWire application screens and interactions, NFL/NBA research integration, GamewAIre model presentation, saved forecast snapshots, account-separated device research notes, and the original-research-versus-recorded-results workflow.

**[Owner: confirm the actual SDK/plugin inventory of the submitted Median binary and disclose any additional nonstandard shared component. Do not claim knowledge of Median's internal reuse across its customers.]**

### 9. Client/partner involvement and submission ownership

GameWire is submitted directly by the owner/content provider of the GameWire concept, branding and original analysis, under that owner's developer account. Median supplies the wrapping technology; it is not submitting the app on the owner's behalf.

**[Owner: explicitly confirm whether any client, partner or other party supplied the concept, branding or app content, and whether any commercial template beyond Median was used. If yes, identify the party/component and explain the ownership and submission relationship. Do not omit this question.]**

## App Store metadata drafts

### App name

GameWire

### Subtitle (27 characters)

Your NFL & NBA Research Hub

### Description

Research the matchup. Save your reasoning. Revisit the result.

GameWire brings NFL and NBA player research, matchup simulations and your own game-day notebook into one place.

MY GAME PLAN
Save player or matchup research exactly as displayed, add personal notes, and find it again by player, matchup or keyword. After the game, save verified finals alongside the original research to see what happened without losing what you originally studied.

PLAYER RESEARCH
Find NFL and NBA players by first name, surname or partial name. Explore recorded statistics and supported matchup projections. NBA research includes recent-game context, points, rebounds, assists, PRA and three-pointers when available.

MATCHUPS AND THE WIRE
Follow scores and game status, inspect player box scores and explore GamewAIre matchup simulations. Keep your favorite teams and players together in Locker Room.

SAVED RESEARCH ON YOUR DEVICE
Reopen saved research, personal notes and previously checked finals without downloading them again once the app is available. Research is device-only and separated by account; it does not sync across devices and can be lost if device storage is cleared. New statistics, forecasts and final-result checks require an internet connection.

Estimates are experimental and may be incomplete. Missing statistics are not invented. GameWire is a research tool, not a guarantee of results or a betting recommendation. Sports-data availability may vary.

### Suggested What's New

- My Game Plan: save NFL/NBA player and matchup research with personal notes.
- Revisit original forecasts beside separately verified final results.
- Search saved research and filter by sport.
- Reopen previously saved research on your device offline.
- New skippable guide for the explore, save and revisit workflow.

## Private review instructions / demo walkthrough

Version/build: **[enter reviewed Median version and build]**
Device/iOS tested: **[enter actual device and iOS version]**
Review login: **[supply privately in App Store Connect, not here]**

1. Launch the submitted iPhone app and sign in with the supplied review account. Guest browsing exists, but authenticated GamewAIre features require sign-in.
2. Read or skip the research guide. It is an inline guide and can be reopened using How it works.
3. Open GamewAIre and its shared player search. Search for a currently active NFL or NBA player by first or last name. Select a player with a supported saved projection.
4. On the player card choose Save to My Game Plan. Add a note and save on this device.
5. Choose Open My Game Plan, or open Locker Room. My Game Plan is above the existing favorites activity.
6. Open the saved item, inspect the original research timestamp/identity and values, edit the note, and press Save note.
7. With the app already loaded, disconnect the network and reopen Locker Room. The saved research and saved notes remain available. Checking new finals requires reconnecting; a clear message explains this.
8. Reconnect. Open a completed NFL/NBA game's GamewAIre simulation with an available saved forecast, save it, and open that item in My Game Plan.
9. Choose Check final result. Verified recorded results appear in a separate After the game section; the original snapshot is not regenerated or overwritten.
10. Use the sport selector and research search to filter saved items. Removal requires confirmation. Research is stored only on this device and does not appear when switching to another account or guest mode.

Owner preparation: choose actual player names and completed matchup examples shortly before review and include them in the private notes. Do not manufacture a finished result or fabricate an available forecast to complete this demo.

## Submission strategy

Reply to the nine questions with verified facts, an actual walkthrough recording and documented beta examples. Ask App Review to reassess the specific workflow and ownership arrangement. Only submit an updated build when the review conversation and actual Median packaging require it, and ensure the screenshots and metadata describe what that build really does.

Official references:

- [App Review Guidelines, including 4.2, 4.2.6 and 4.3](https://developer.apple.com/app-store/review/guidelines/)
- [TestFlight](https://developer.apple.com/testflight/)
