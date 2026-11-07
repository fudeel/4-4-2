# 4-4-2

A mobile-first, turn-based, card-driven **6-a-side football manager**. TypeScript everywhere, Three.js for the match, a small authoritative Node server for multiplayer, and a local JSON database.

> Scope of this version: **the match only**. Leagues, rankings, finances and transfers come later.

## Quick start

```bash
npm install
npm run dev
```

- Open **http://localhost:5173**. The game server runs on port 3001 and Vite proxies `/ws` to it.
- **Two-player test on one computer:** click *Play a friend*, then open the same URL (it now contains `?room=CODE`) in a **second tab or browser**. Each tab is a different manager (the identity lives in `sessionStorage`), and reloading a tab keeps your seat.
- **On your phone:** use the *Network* URL that Vite prints (e.g. `http://192.168.1.x:5173`) while on the same Wi-Fi.
- **Solo:** *Practice vs AI* puts a bot in the away seat.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Engine/rules test suite (Vitest) |
| `npm run simulate -- 2000` | Plays 2000 bot-vs-bot matches and prints balance stats (`--swap` swaps home/away, `--home=-100` / `--away=50` fix a side's mentality) |
| `npm run typecheck` | Type-checks client and server |
| `npm run build && npm start` | Production: one server on port 3001 (or `$PORT`/`$GAME_PORT`) serving the built client and WebSocket |

## How a match works

- **6 v 6**, two squads of 12 (24 fictional players in `src/server/data/seed.ts`). Every player has PAC/SHO/PAS/DRI/DEF/PHY/GK/STA attributes (1–99) and sometimes a trait (Clinical, Playmaker, The Wall, Speedster, Cat Reflexes, Engine, Hothead, Aerial Threat, Leader).
- **Before kick-off** each manager picks a formation (2-2-1, 3-1-1, 2-1-2, 1-3-1, 1-2-2), arranges the starting six and presses *Ready*.
- **Turns:** every turn is **5 in-game minutes**, so a half is 9 turns and the match is 18. Possession alternates: one team attacks, the other defends.
- **Mentality (Defence ↔ Attack):** a slider every manager can move at any moment (lobby, every turn, half-time). It covers the always-on decisions — how hard to tackle, how deep to defend, how many players join the attack — and the team visibly sits deeper or pushes up on the pitch. See the table below.
- **Cards:** both managers secretly pick **one card or skip** within 20 s; cards are revealed together. You hold at most **3**, draw one every 2 turns, and hands refill at half-time. Cards are timed: attack cards only while you have the ball, defence cards only while defending, some any time.
- **Resolution:** an attack is a chain of dice rolls — *build-up* (midfield battle) → *chance creation* (final third, sets the chance quality) → *shot* (block → on target → beat the keeper). Odds come from the involved players' stats, position fit, fatigue, traits, momentum and cards. Every roll is shown on screen (`Build-up 64% · 🎲 41 ✓`).
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
- **Players think, the server decides.** The server rolls the dice; the client only decides *how it looks*. Off the ball, `TeamShape` positions everyone from the ball and possession — width, support angles and forwards on the last defender's shoulder in possession; a narrow, ball-side block, goal-side of the ball, with one player pressing, out of it — and nothing moves at random. On the ball, `BallPlanner` scores each pass (receiver free? lane safe? forward? comfortable length?) or carries the ball into space. Players jog into position and sprint only when it matters.
- **Stylised low-poly look.** Players, ball and props are flat-shaded and vertex-coloured, so a body segment is one mesh and every player shares one material; the ball's pentagons come from subdividing an icosahedron. One low golden-hour sun casts real (PCF soft) shadows, ACES tone mapping and a sky dome set the mood, the nets bulge when a goal goes in and the scoring side's fans jump — all fan motion runs in the vertex shader (two draw calls for ~2,000 fans). Phones get a smaller shadow map.
- **No spoilers.** Commentary lines and the score are revealed in step with the 3D animation.

The local database is `data/db.json` (created and seeded on first run). It stores teams, players, finished matches and per-player career stats. Delete it to reset.
#   4 - 4 - 2  
 