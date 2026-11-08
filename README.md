# 4-4-2

A widescreen, turn-based, card-driven **6-a-side football game**. TypeScript everywhere, Three.js for the match, a small authoritative Node server for multiplayer, and a local JSON database.

> Create a manager account, build a persistent club, develop your squad and bring friends together for an evening of football.

## Quick start

```bash
npm install
npm run dev
```

- Open **http://localhost:5173**. The game server runs on port 3001 and Vite proxies `/ws` to it.
- **First visit:** register with a username (1–16 letters, no numbers, spaces or symbols) and a password (8–128 characters). Then name your club and choose its abbreviation and colour. No email is required.
- **Two-player test on one computer:** use two browser profiles, or a regular window and a private window, with separate accounts. Cookies identify the manager; a reload keeps your seat. Two tabs in the same profile share an account.
- **On your phone:** use the *Network* URL that Vite prints (e.g. `http://192.168.1.x:5173`) while on the same Wi-Fi. Rotate to landscape; portrait shows a rotation prompt. Menus and matches use a centred **16:9 surface**, with letterboxing on other screen shapes. Rotation preserves the current screen and live match; match timers continue.
- **Solo:** *Practice vs AI* puts a bot in the away seat.
- **Friends night:** host a night, share its **five-letter code** or invitation link, and invite 2–8 managers. The host starts a round-robin evening with balanced, quick matches, live standings and club prizes. Exhibition rooms use **four-character codes**.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Engine/rules test suite (Vitest) |
| `npm run simulate -- 2000` | Plays 2000 bot-vs-bot matches and prints balance stats (`--swap` swaps home/away, `--home=-100` / `--away=50` fix a side's mentality) |
| `npm run typecheck` | Type-checks client and server |
| `npm run build && npm start` | Production: one server on port 3001 (or `$PORT`/`$GAME_PORT`) serving the built client and WebSocket |

## Your club

Every club starts equally: **12 basic players, 100,000 credits, 50 fans, a level-1 stadium (100 seats), a level-1 training ground and no youth academy**. Your club colours, lineup, finances, match history, development and trophies are saved on the server.

- **Exhibitions:** quick games have 6 turns, 12-second planning and a 15-second break; classic games retain 18 turns and the original timing. Play a friend by room code or choose casual, balanced or challenging AI. Fair play balances match squads without modifying saved player attributes; turn it off to use club strength. Clashing away kits are adjusted automatically.
- **Finances and fans:** completed matches earn appearance and performance income; the home side also earns gate receipts based on actual attendance. Morale, reputation and results affect demand and growth. Repeat opponents progressively reduce income; after 12 exhibitions in a rolling 24-hour window, credit rewards drop to 25%. Results settle once.
- **Facilities:** stadium expansion depends on demand and experience. Training improves XP and development efficiency. Academy levels improve the quality and frequency of prospects. All facilities cap at level 5; quotes explain costs, benefits and prerequisites before purchase.
- **Players:** train individual skills using credits and XP. Age, role, training facilities, existing skills and potential determine costs and gains. Save your starting six from the club screen; promote academy prospects or release eligible bench players while keeping at least 12 players and two keepers. Squads cap at 18.
- **Youth:** once built, an academy produces a prospect every 2–4 completed exhibitions, prioritising positions needing depth. No real-time waiting is required. Up to three prospects can await promotion.
- **Friends night:** squads are sealed when the evening starts. Every pair meets once; different games in the same round can run simultaneously. Standings use points, goal difference and goals scored; complete ties share the place. Managers can concede their own games 0–1. Walkovers do not earn match income; nights consisting entirely of walkovers do not award prizes. Podium places earn trophies, with 10,000/5,000/2,500-credit prizes; other participants receive 1,000 credits.

## Implementation branches

The five branches are cumulative and can be reviewed/merged in order. **Branch 5 contains the complete implementation.**

| Branch | Adds |
| --- | --- |
| `codex/01-accounts` | Registration, login, logout, persistent authenticated sessions |
| `codex/02-clubs` | Club creation, equal starter squads, resources and club dashboard |
| `codex/03-exhibitions` | Owned clubs in code/AI exhibitions, quick/classic settings, saved results |
| `codex/04-progression` | Facilities, income, fan growth, training, youth and atomic spending |
| `codex/05-friends-night` | Complete game, multi-manager evenings, schedules, standings, trophies, squad management and polish |

The follow-up `codex/06-widescreen-football-ui` branch restyles the complete game with illustrated mode cards, vivid football colours, a kit-based player collection, dedicated squad/club/development tabs, and a broadcast match HUD. The gameplay and economy rules stay authoritative on the server. Original artwork paths and generation prompts are documented in [docs/ui-art.md](docs/ui-art.md).

## How a match works

- **6 v 6**, two squads of 12 (24 fictional players in `src/server/data/seed.ts`). Every player has PAC/SHO/PAS/DRI/DEF/PHY/GK/STA attributes (1–99) and sometimes a trait (Clinical, Playmaker, The Wall, Speedster, Cat Reflexes, Engine, Hothead, Aerial Threat, Leader).
- **Before kick-off** each manager picks a formation (2-2-1, 3-1-1, 2-1-2, 1-3-1, 1-2-2), arranges the starting six and presses *Ready*.
- **Turns:** every turn is **5 in-game minutes**, so a half is 9 turns and the match is 18. Possession alternates: one team attacks, the other defends.
- **Mentality (Defence ↔ Attack):** a slider every manager can move at any moment (lobby, every turn, half-time). It covers the always-on decisions — how hard to tackle, how deep to defend, how many players join the attack — and the team visibly sits deeper or pushes up on the pitch. See the table below.
- **Cards:** both managers secretly pick **one card or skip** within 20 s; cards are revealed together. You hold at most **3**, draw one every 2 turns, and hands refill at half-time. Cards are timed: attack cards only while you have the ball, defence cards only while defending, some any time.
- **Resolution:** an attack is a chain of dice rolls — *build-up* (midfield battle) → *chance creation* (final third, sets the chance quality) → *shot* (block → on target → beat the keeper). Odds come from the involved players' stats, position fit, fatigue, traits, momentum and cards. Every roll is shown on screen (`Build-up 64% · 🎲 41 ✓`).
- **Who does what is decided, not random:** players are matched by zone from the two formations — the forward is pressed by the defender facing him, the shooter is blocked by his marker, the corner taker's target has his own man to beat. The carrier dribbles when he's better than his opponent and passes when he can find someone free (forwards first). Chances fall to the best-placed finisher, and the creator picks the way that suits the players: a *through ball* for a quick runner, a *cross* (finished with a header) from a wide creator, a *cut-back* after beating his man, a *shot from distance* against a packed defence, or a *solo run*. Each is animated differently.
- **Set pieces & discipline:** fouls can give free kicks or penalties, saves and blocks can give corners (aerial duels → headers), yellow/red cards exist and a red card leaves you a player down (an outfielder takes the gloves if the keeper goes).
- **Momentum & counters:** winning duels swings momentum (±6% ratings). Winning the ball cleanly in midfield springs a **counter-attack** bonus on your next attack.
- **Fatigue:** energy drains every turn (stamina and the Engine trait slow it), lowering all stats — so **half-time (45 s)** matters: change formation and make up to **3 substitutions** (you can change your mind until play resumes).

### Mentality

The slider goes from −100 (*Ultra defensive*) to +100 (*All-out attack*); effects scale linearly in between. The side you lean towards gains more than the side you neglect loses — the real price is paid in fouls or in exposure.

| | Ultra defensive (−100) | Balanced (0) | All-out attack (+100) |
| --- | --- | --- | --- |
| Attack (build-up, chance creation) | −18% | — | +24% |
| Defence (pressing, final third) | +24% | — | −18% |
| Fouls committed | ×1.6 (more free kicks, penalties and bookings) | — | — |
| Blocks / chance quality | +5% blocks | — | +6% chance quality |
| Counter-attacks conceded when you lose the ball | — | — | 20% |
| Fatigue | — | — | +1 energy per player per turn |

Bot-vs-bot (`npm run simulate -- 1500 --home=-100`): ultra defensive cuts a match from ≈2.5 to ≈1.9 goals (scores −28%, concedes −20%) — ideal to protect a lead; all-out attack raises your goals by ≈38% but concedes ≈47% more — a gamble for when you're chasing. Balanced has the best average goal difference. Cards stay the sharper, scarcer tools (Park the Bus is +35% in one turn without the extra fouls).

The numbers live in `MENTALITY_TUNING` (`src/shared/model/tactics.ts`); the slider's effect text is generated from them. In the engine the slider is just another `ActionModifier` (`MentalityModifier`).

### The cards

| Card | When | Effect |
| --- | --- | --- |
| 🔁 Tiki-Taka | Attack | +30% build-up |
| 🎯 Through Ball | Attack | +30% chance creation |
| 💥 Power Shot | Attack | +25% finishing |
| 🚀 Long Ball | Attack | Skip the midfield battle, −10% chance creation |
| ⭐ Talisman | Attack | Your best attacker shoots with +20% to every stat |
| 🏰 **Siege** | Attack | **You also attack the next 2 turns (3 attacks in a row)**; your players tire faster |
| 🎭 Simulation | Attack | 40% win a penalty, otherwise booked and the attack ends |
| 🐺 High Press | Defence | +30% pressing; winning the ball triggers a counter-attack |
| 🚌 Park the Bus | Defence | +35% final-third defence, more blocks |
| 🚩 Offside Trap | Defence | 45% (+20% vs Long Ball) offside; if it fails they're through 1-on-1 |
| 🦵 Tactical Foul | Defence | Kills the attack, your player is booked (near the box it's a free kick) |
| 🧤 Keeper Heroics | Defence | +30% goalkeeper |
| 🔒 Man Marking | Defence | Their best attacker −30% |
| 💧 Second Wind | Any | +25 energy to everyone on the pitch |
| 📣 Team Talk | Any | +10% to all ratings for 3 turns |
| 🃏 Mind Games | Any | Cancels the card your opponent plays this turn |

All numbers live in `CARD_TUNING` (`src/shared/model/cards.ts`) and the rules in `DEFAULT_RULES` (`src/shared/rules.ts`), so the card text and the engine never disagree.

## Architecture

```
src/
  shared/            Types and rules used by both sides (no I/O)
    model/           Player, team, formation, lineup (+ validator/builder), cards, match view types
    protocol.ts      Client ↔ server messages
    rules.ts         Match rules (turn length, timers, hand size…)
  server/
    core/            Seedable RNG, scheduler/clock abstractions, errors
    data/            Repository interfaces + JSON-file implementation + seed data
    match/
      engine/        ActionResolver, phases (build-up, chance, shot, set pieces), ratings, modifiers, commentary
      cards/         Card hand/dealer and one strategy class per card effect
      effects/       Effects that last several turns (Siege, Team Talk)
      flow/          MatchState, TurnResolver, possession/momentum/fatigue, per-player view builder
      Match.ts       The state machine: lobby → planning ⇄ resolving → half-time → … → full-time
    ai/              BotManager (uses only public Match commands)
    rooms/           Room (seats, reconnection, rematch) and RoomRegistry
    net/             WebSocket gateway, message validation, static file serving
    main.ts          Composition root
  client/
    net/             WebSocket connection with auto-reconnect, per-tab identity
    state/           Observable store + GameActions interface
    ui/              Screens (home, lobby, match), lineup editor, HUD widgets, sheets
    presentation/    ActionPlayback: replays an action on the server's timeline
    render/          Three.js: player/ball actors, camera rig, MatchDirector choreography
      tactics/       TeamShape (where every player stands off the ball) and BallPlanner (pass / carry / hold)
      stadium/       Stadium (sky, golden-hour light + shadows, grass, stands, props), Goal (animated net), Crowd (GPU-animated fans)
```

Design notes:

- **Authoritative server.** The client never decides anything: it sends intents (`playCard`, `setLineup`…) and renders the state it receives. Each manager receives a *personal view*: the opponent's hand and selected card are hidden.
- **Open/closed engine.** Cards plug into the engine through the optional hooks of `ActionModifier` (`teamMultiplier`, `playerMultiplier`, `intercept`, `chooseShooter`, …). A new card is a new `CardEffect` class plus an entry in the registry — no engine changes.
- **Dependency inversion.** Game code depends on `GameDatabase`/repository interfaces, `Rng`, and `Scheduler`. Swapping the JSON file for a real database, or running matches in fast-forward for tests and balancing, needs no changes to the game logic.
- **Deterministic and testable.** With a seeded RNG and the `ManualScheduler`, a full match is reproducible; `npm run simulate` uses this to tune balance (currently ≈2.6 goals per match, ≈6% goalless).
- **Players think, the server decides.** The server rolls the dice; the client only decides *how it looks*. Off the ball, `TeamShape` positions everyone from the ball and possession — width, support angles and forwards on the last defender's shoulder in possession; a narrow, ball-side block, goal-side of the ball, with one player pressing, out of it — and nothing moves at random. Out of possession the block holds a flat back line set by the ball (and the mentality), defenders pick up the attackers in their zone goal-side and only break the line to track a run in behind, midfielders screen in front, forwards cut the pass back, the nearest player presses with the next one covering behind him, the keeper stands on the line between ball and goal, and a team that loses the ball sprints back into shape. Attackers read the defenders' intended line (not their current positions) to stay onside, so the two shapes never chase each other towards goal. On the ball, `BallPlanner` scores each pass (receiver free? lane safe? forward? comfortable length?) or carries the ball into space. Players jog into position and sprint only when it matters.
- **Stylised low-poly look.** Players, ball and props are flat-shaded and vertex-coloured, so a body segment is one mesh and every player shares one material; the ball's pentagons come from subdividing an icosahedron. One low golden-hour sun casts real (PCF soft) shadows, ACES tone mapping and a sky dome set the mood, the nets bulge when a goal goes in and the scoring side's fans jump — all fan motion runs in the vertex shader (two draw calls for ~2,000 fans). Phones get a smaller shadow map.
- **No spoilers.** Commentary lines and the score are revealed in step with the 3D animation.

Persistent data is created on first run: `data/db.json` stores match records/career stats, `data/managers.json` stores accounts and session digests, `data/clubs.json` stores owned clubs and progression, and `data/nights.json` stores evenings and sealed squads. Back up all four together. Corrupt data is preserved and reported rather than silently reset.

Environment overrides: `GAME_PORT`, `DB_PATH`, `ACCOUNTS_PATH`, `CLUBS_PATH`, and `NIGHTS_PATH`. Passwords use salted scrypt hashes. Sessions expire after seven days, use HttpOnly/SameSite cookies, and are revoked on logout. For an HTTPS reverse proxy, set `COOKIE_SECURE=true`; plain HTTP is supported for local Wi-Fi play. Username/password-only accounts do not include email recovery.

Exhibition rooms are held in memory. On a server restart, interrupted friends-night fixtures become pending again; completed scores and prizes remain saved. This JSON-backed server is intended for one Node process.

`npm test` includes account/API/socket ownership, persistence, club economy, development, fixture scheduling, reserved seats, score/prize idempotency, restart recovery, the match engine and 3D playback regressions.
#   4 - 4 - 2  
 
