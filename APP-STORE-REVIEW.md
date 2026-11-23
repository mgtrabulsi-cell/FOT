# GameWire: current App Review response

## Current review status

The nine-question reply below was sent through App Store Connect on November 23, 2026. Apple replied the same day and maintained the rejection: the app still provides the same feature set as other submitted apps, and should be revised to provide a unique experience. No new build was resubmitted.

A follow-up explaining GameWire's custom statistical algorithm, stat-backed research and player-to-matchup-to-result workflow was subsequently sent and verified in the conversation. That clarification is awaiting Apple's response; it is not an accepted appeal or approval.

The metadata below remains preparation material, not proof that App Store listing changes were saved. Another submission needs substantive product differentiation or a supported appeal, not merely this revised wording.

Prepared for the current app after removal of My Game Plan. Do not advertise that removed feature or its notes/save workflow. Apple requested a reply to its questions before another submission; this packet is not a guarantee of approval or authorization to bypass that instruction.

## Reply to App Review

Thank you for the feedback under Guidelines 4.3 and 4.2.6. We understand that using a wrapper or changing appearance alone does not establish sufficient differentiation. Below are our answers about the actual GameWire product, its ownership, testing and third-party technology. Please review this information before we make another submission.

## Custom algorithm clarification

Thank you for reviewing our response. We would like to clarify that GameWire's primary product is its custom player-and-matchup research engine; live scores supply context for that research rather than being the entire experience.

GamewAIre uses statistical analysis implemented specifically in the GameWire application and backend. It is not a prebuilt sports-tip template, a provider's prediction feed, or a generic AI prompt presented as our numerical model. Median supplies the iPhone container, not this analysis engine.

The original research pipeline includes:

1. Player and matchup estimates derived from recorded production, recent form, supported role/workload information and upcoming-opponent context. NFL simulations include position-specific passing, rushing, receiving and touchdown estimates and supported quarterback scenarios. NBA simulations model points, rebounds, assists, PRA and made threes when sufficient evidence exists, including recent-minute roles and verified availability context.

2. Model probabilities computed from supported historical evidence with recent-game weighting and a neutral prior. Where selections are shown, model hit probability is distinct from sportsbook implied probability. Prices do not create the numerical hit estimate or rank a selection by payout.

3. Evidence safeguards: missing personal samples are not fabricated; limited estimates are labeled; and learning adjustments activate only when their minimum-history and chronological-validation checks pass. We do not claim guaranteed accuracy, betting profit or that a player is automatically due after a cold streak.

4. A before-and-after analysis workflow: available forecasts are saved before games and retained for comparison with recorded outcomes, rather than regenerated after the result. The result presentation includes NFL projected-scorer versus verified-scorer comparisons and NBA team/player production graphics.

5. Stat-backed player/matchup research and contributor analysis alongside the live game context. Users can inspect recorded statistics, supported model estimates and opinion-based analysis rather than receiving only a score or an unexplained pick.

ESPN, API-Sports and other disclosed providers supply underlying measurements and market information, not ownership of the GameWire model. Optional OpenAI integration, where configured, selects supported explanation facts; it does not set the numerical probabilities or prices.

For review, please inspect The Wire's NFL/NBA matchup simulation views, Stat Hub's recorded player statistics, GamewAIre's player cards with supported projections and opponent context, and Simulation Results for a completed game with a retained pregame forecast. Use the existing private review account where sign-in is required. Some forecasts remain unavailable when evidence is insufficient.

We understand that original code alone does not automatically satisfy Guideline 4.3, and we are not claiming access to competitors' private algorithms. Our distinction is the original GameWire research engine and its connected player-to-matchup-to-result experience, not merely the scoreboard's appearance. We request reconsideration of that experience and would appreciate specific guidance on what additional evidence or user-facing differentiation you require.

## Detailed nine-question answers

### 1. What the app does and the primary problem it solves

GameWire combines NFL and NBA player research, matchup forecasts, live game context and recorded results. A user can find a player by first name, surname or partial name, inspect recorded statistics and recent appearances, and view supported matchup estimates through GamewAIre. NBA statistics include points, rebounds, assists, PRA and made three-pointers when available.

The Wire presents games, player box scores and separate matchup simulation views. Available pregame forecasts are retained for later comparison with recorded results rather than regenerated after the outcome. NFL touchdown-result graphics compare projected scorers with verified scorers; NBA matchup views and graphics present team score estimates and player production. Unsupported or missing information is labeled unavailable, not invented.

The primary problem is the fragmentation of player, matchup and game-result research across separate screens and sources. GameWire connects that research across NFL and NBA within one product. These are estimates and information tools, not guaranteed results. My Game Plan and its personal-note/save controls are not part of the current app.

### 2. Intended users

The intended users are NFL and NBA fans who study player production, recent form and upcoming opponents, including fantasy-sports participants researching player usage and matchup context. They also want to follow live games and review forecast results afterward. The research workflow does not require placing a wager.

### 3. Need or gap addressed

GameWire brings a shared NFL/NBA player search, sport-specific modeled player lines, matchup simulations, retained pregame forecasts, verified postgame comparisons and downloadable game/result graphics into a connected experience. Locally retained player statistics support faster repeat access, while current data and new analysis require internet access.

We are not claiming that other sports apps lack statistics or predictions, or that GameWire exclusively owns league data. The differentiation we ask App Review to assess is the original integration of these player-to-matchup-to-result interactions and the GameWire analysis and result presentation built around them. We understand that App Review must determine whether that differentiation satisfies Guideline 4.3.

### 4. Beta testing and applied feedback

More than 30 people participated through website/browser access, not TestFlight. Testing sessions took place on November 7, November 14 and November 21, for approximately one hour per session.

The developer's reported feedback areas were player search, game simulations, notification choices and box-score presentation. Applied changes include first-name/surname/partial-name player search, combined NFL/NBA player research, clearer matchup forecasts, differentiated notification controls and more compact, horizontally scrollable mobile statistical tables.

We are not presenting those browser sessions as TestFlight testing or as a native iOS beta program. The developer separately confirmed checking the current experience inside the Median app. A recent authentication-service incident was recovered, and the current web app now offers guest recovery after a twelve-second slow session check. That latest recovery change is not represented as having been tested in the earlier beta sessions.

### 5. Standalone product or suite

GameWire is a standalone product. There are no other apps on our developer account. NFL and NBA experiences are combined in this one app rather than distributed as near-identical sport, team or branding variants.

### 6. Consolidation into another app

There is no other app on our developer account into which GameWire could be consolidated. Its supported NFL and NBA experiences are already consolidated in one product.

### 7. Significant code, frameworks or assets shared with other apps on the account

There are no other apps on our developer account with which GameWire shares application code or assets. Standard third-party technologies and the Median wrapper are disclosed below; we do not claim that the entire binary is original native code.

### 8. Third-party codebase, SDK or content library

The iPhone app uses Median to package and deliver the GameWire web application. The application is built with React, TypeScript and Vite, with Supabase services. The developer reported no additional purchased templates, nonstandard shared code or undisclosed third-party involvement beyond the disclosed technologies and providers.

Sports information comes from third-party providers including ESPN, API-Sports and The Odds API where used; Wikidata supplies supported birth-date information. Optional OpenAI integration, where configured, selects supported explanation facts; it does not set the numerical probabilities or sportsbook prices. Provider data is not represented as exclusive GameWire-owned content. The repository also contains Capacitor integration, but this is not a claim that Capacitor is included in the submitted Median binary.

The original application functionality includes the GameWire screens and interactions, combined NFL/NBA player discovery, sport-specific GamewAIre analysis, retained matchup forecasts, comparison against recorded game outcomes, local statistical persistence and game/result graphic exports. Median supplies the wrapper technology rather than these application workflows.

### 9. Client, partner, branding and submission ownership

GameWire is submitted directly by the owner/content provider of the GameWire concept, branding and original application analysis under that owner's developer account. It was not created for a client or partner who supplied the concept or branding. Median is the technology provider; it is not the content owner or the party submitting GameWire on someone else's behalf.

## Reply field version

Thank you for the feedback under Guidelines 4.3 and 4.2.6. We understand that a wrapper or cosmetic changes alone do not establish differentiation. These answers describe the current GameWire product. Please assess this information before another submission.

1. PURPOSE AND PROBLEM
GameWire connects NFL/NBA player research, matchup simulations, live box scores and recorded results. Users find players by first name, surname or partial name; inspect recent statistics and supported projections; and compare retained pregame forecasts with verified outcomes. NBA statistics include PTS, REB, AST, PRA and made threes when available. The problem is fragmented player-to-matchup-to-result research. Missing data is labeled unavailable. My Game Plan and its note/save controls have been removed.

2. INTENDED USERS
NFL/NBA fans who study player production and opponents, including fantasy-sports participants researching usage and recent form. Users can follow games and examine forecast results without placing a wager.

3. GAP AND DIFFERENTIATION
The original experience combines shared NFL/NBA player discovery, sport-specific modeled lines, matchup forecasts retained before games, verified postgame comparison and game/result graphic exports. Examples include NFL projected-touchdown-scorer versus actual-scorer results and NBA team/player production graphics. Local statistical retention supports repeat access. We do not claim exclusive league data or that other apps lack predictions. We ask App Review to assess this integrated workflow rather than a scores-only or reskinned template app.

4. BETA TESTING
More than 30 testers used website/browser access, not TestFlight, on November 7, 14 and 21, for approximately one hour per session. Reported feedback concerned search, simulations, notifications and box scores. Applied changes include partial/first-name search, combined NFL/NBA player research, clearer matchup forecasts, differentiated notification controls and compact scrollable mobile statistics. The developer separately confirmed checking the current experience in the Median app; we do not represent the browser sessions as a native iOS beta program. The latest login-recovery change was not part of those earlier sessions.

5. STANDALONE OR SUITE
GameWire is standalone. There are no other apps on our developer account, and NFL/NBA experiences are combined in this one product.

6. CONSOLIDATION
There is no other app on our account into which this functionality could be consolidated.

7. SHARING WITH OUR OTHER APPS
There are no other apps on our account with which GameWire shares application code or assets. We do use the standard technologies and wrapper disclosed below; the entire binary is not claimed to be original native code.

8. THIRD-PARTY TECHNOLOGY AND CONTENT
The iPhone app uses Median to deliver our React/TypeScript/Vite application, with Supabase services. Sports inputs include ESPN, API-Sports and The Odds API where used; Wikidata supplies supported birth-date information. Optional OpenAI integration, where configured, selects supported explanation facts rather than setting numerical probabilities or prices. No additional purchased template or nonstandard shared application code was reported. Median supplies packaging, not the original GameWire screens, research integration, forecast/result workflow, local statistics or graphics. Provider data is not exclusive GameWire-owned content.

9. CONTENT OWNER AND SUBMISSION
GameWire is submitted directly by the owner/provider of its concept, branding and original analysis under that owner's developer account. It was not created for a client or partner supplying the concept or branding. Median is the technology provider, not the content owner or a party submitting on someone else's behalf.

## Current metadata

### Subtitle

Your NFL & NBA Research Hub

### Promotional text

Explore NFL and NBA players, matchup estimates, live box scores and forecast results in one connected sports research hub.

### Description

Research players. Explore matchups. Follow the result.

GameWire combines NFL and NBA player statistics, matchup simulations and live game context in one sports research hub.

PLAYER RESEARCH
Find players by first name, surname or partial name. Inspect recorded statistics, recent appearances and supported matchup estimates. NBA research includes points, rebounds, assists, PRA and made three-pointers when available.

THE WIRE
Follow NFL and NBA scores and game status, inspect player box scores, and switch between matchup and GamewAIre simulation views. Pregame injury reports distinguish explicitly reported OUT players from uncertain designations.

FORECASTS AND RESULTS
Explore supported team and player estimates and review available saved pregame forecasts against recorded results. Create game and result graphics from supported data. Forecasts are not regenerated after kickoff to manufacture a successful prediction.

YOUR FAVORITES
Keep favorite teams and players together in Locker Room. Locally retained public statistics support faster repeat browsing; current feeds, new analysis and new result checks need an internet connection.

GameWire estimates are experimental and can be incomplete. Missing statistics are not invented. Estimates and displayed odds are not guarantees of outcomes or betting recommendations. Sports-data and market availability vary. Some account features require sign-in.

GameWire is independent and is not affiliated with or endorsed by any sports league, team or data provider. GameWire does not accept or place wagers.

### Review notes / walkthrough

Use the review account supplied in App Store Connect's private Sign-In Information fields. Do not include passwords in this document.

1. Open the app. Sign in using the supplied review account, or choose Continue as guest for public browsing. A slow initial session check now exposes guest recovery after twelve seconds.
2. Open The Wire and choose NFL or NBA. Open an available matchup, inspect its game status/player statistics and switch to the GamewAIre simulation view where a supported forecast exists.
3. Open Stat Hub to search NFL/NBA player statistics and inspect available game records. Use a player's first name, surname or partial name.
4. While signed in, open GamewAIre's player search and inspect a supported player card with projected statistics and recent/opponent context.
5. Open Simulation Results for a completed game with a retained pregame forecast. Compare that original forecast against verified results and inspect the available result graphics.
6. Add a team/player favorite and open Locker Room to view the associated activity.

My Game Plan, its research guide and its save/note controls have been removed and must not be part of the walkthrough.

## Before any new submission

- Follow Apple's request to reply first. Do not describe this reply as an accepted appeal or approved resubmission.
- App Store Connect currently lists iOS version 1.0 and build 1.0.0 (9). Confirm that this is the build actually tested, and record its tested device/iOS version; the owner confirmed testing but did not supply those details.
- Verify the existing private reviewer account works in the selected build. Do not replace credentials with an untested account.
- Confirm screenshots match the current app and contain no removed My Game Plan controls.
- Check the actual Median plugin inventory and native settings against the binary; do not infer shipped SDKs from repository dependencies.
- Confirm relevant sports-data display/redistribution permissions. Public API availability is not proof of commercial rights.
- Attach genuine beta feedback or recordings if available. Do not invent TestFlight participation, screenshots, tester quotes or native-device evidence.

References: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [TestFlight](https://developer.apple.com/testflight/).
