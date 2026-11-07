/// <reference lib="dom" />
import { Scene, Texture, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionPlayback } from '../src/client/presentation/ActionPlayback';
import { BallActor } from '../src/client/render/BallActor';
import { CameraRig } from '../src/client/render/CameraRig';
import { MatchDirector } from '../src/client/render/MatchDirector';
import { PITCH } from '../src/client/render/PitchSpace';
import type { PlayerActor } from '../src/client/render/PlayerActor';
import type { Sfx } from '../src/client/audio/Sfx';
import { SeededRng } from '../src/server/core/Random';
import { ManualScheduler } from '../src/server/core/Scheduler';
import { SEED_PLAYERS, SEED_TEAMS } from '../src/server/data/seed';
import { Match } from '../src/server/match/Match';
import { BotManager } from '../src/server/ai/BotManager';
import type { ActionReport, MatchEvent, MatchView, Side } from '../src/shared/model/match';
import { DEFAULT_RULES } from '../src/shared/rules';

// Exercise real actor movement/Three.js geometry without a browser or GPU.
vi.mock('../src/client/render/textures', () => ({
  createShadowTexture: () => new Texture(),
  createShirtNumberTexture: () => new Texture(),
  createLabelTexture: () => ({ texture: new Texture(), aspect: 1 }),
}));

function game(seed = 7) {
  const scheduler = new ManualScheduler();
  const setup = (i: number) => ({ team: SEED_TEAMS[i]!, squad: SEED_PLAYERS.filter(p => p.teamId === SEED_TEAMS[i]!.id) });
  const match = new Match({ roomCode: 'TEST', home: setup(0), away: setup(1) }, { scheduler, rng: new SeededRng(seed), rules: DEFAULT_RULES });
  return { match, scheduler };
}

function renderer(viewer: Side = 'home') {
  const { match } = game();
  for (const side of ['home', 'away'] as const) {
    match.assignManager(side, { clientId: side, name: side, isBot: false, connected: true });
    match.setReady(side, true);
  }
  const view = match.view(viewer);
  const sfx = { kick: vi.fn(), whistle: vi.fn(), card: vi.fn(), roar: vi.fn() };
  const stadium = { cheer: vi.fn(), netImpact: vi.fn(), setTeamColors: vi.fn() };
  const director = new MatchDirector(new Scene(), new CameraRig(), sfx as unknown as Sfx, stadium);
  director.sync(view, 0);
  const state = director as unknown as { ball: BallActor; actors: Map<string, PlayerActor>; pendingReceiver: unknown; queue: unknown[] };
  const player = (side: Side, slot: number) => state.actors.get(view.teams[side].lineup.slots[slot]!)!;
  const hold = (actor: PlayerActor) => {
    state.ball.place(actor.feet());
    expect(state.ball.giveTo(actor)).toBe(true);
  };
  return { director, ...state, state, view, player, hold, sfx, stadium };
}

function event(kind: MatchEvent['kind'], actor?: PlayerActor, target?: PlayerActor, extra: Partial<MatchEvent> = {}): MatchEvent {
  return { kind, side: actor?.side ?? 'home', actorId: actor?.id, targetId: target?.id, durationMs: 1000, text: kind, ...extra };
}

function report(events: MatchEvent[], side: Side = 'home'): ActionReport {
  return { id: 1, turn: 1, minute: 4, attackingSide: side, events, durationMs: events.reduce((n, e) => n + e.durationMs, 0), revealed: [], outcome: 'goal', scoreBefore: { home: 0, away: 0 }, scoreAfter: { home: 1, away: 0 } };
}

function advance(director: MatchDirector, until: number, start = 0) {
  for (let t = start + 1000 / 60; t < until; t += 1000 / 60) director.update(1 / 60, t);
  director.update(1 / 60, until);
}

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.4); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('physical ball contact', () => {
  it('refuses distant possession changes and takes control without moving the ball', () => {
    const r = renderer();
    const receiver = r.player('home', 5);
    r.ball.place(new Vector3(14, 0, -20));
    expect(r.ball.giveTo(receiver)).toBe(false);
    r.ball.place(receiver.feet().add(new Vector3(0.5, 0.3, 0)));
    const at = r.ball.position.clone();
    expect(r.ball.giveTo(receiver)).toBe(true);
    expect(r.ball.position.equals(at)).toBe(true);
    r.ball.update(1 / 60, 0);
    expect(r.ball.position.distanceTo(at)).toBeLessThan(0.15);
  });

  it('lands a pass at a reachable receiver instead of snapping a distant ball to their feet', () => {
    const r = renderer();
    const passer = r.player('home', 3);
    const receiver = r.player('home', 5);
    receiver.teleport(new Vector3(12, 0, -14));
    r.hold(passer);
    const start = receiver.position.clone();
    const action = report([event('pass', passer, receiver), event('cards')]);
    r.director.beginAction(action);
    const landing = r.ball.destination();
    expect(landing.clone().setY(0).distanceTo(start)).toBeLessThan(4.5);
    advance(r.director, 650);
    expect(r.ball.holder?.id).toBe(receiver.id);
    const before = r.ball.position.clone();
    advance(r.director, 670, 650);
    expect(r.ball.position.distanceTo(before)).toBeLessThan(0.5);
  });

  it('leaves a pass loose if the receiver is moved away before contact', () => {
    const r = renderer();
    const passer = r.player('home', 3);
    const receiver = r.player('home', 5);
    r.hold(passer);
    r.director.beginAction(report([event('pass', passer, receiver), event('cards')]));
    const landing = r.ball.destination();
    advance(r.director, 300);
    receiver.teleport(new Vector3(-14, 0, -22));
    advance(r.director, 700, 300);
    expect(r.ball.holder).toBeNull();
    expect(r.ball.position.distanceTo(landing)).toBeLessThan(0.01);
  });

  it('invalidates a reception when a newer kick replaces the flight', () => {
    const r = renderer();
    r.hold(r.player('home', 3));
    r.director.beginAction(report([event('pass', r.player('home', 3), r.player('home', 5)), event('cards')]));
    advance(r.director, 300);
    const goal = new Vector3(1, 0.5, 25);
    r.ball.kick(goal, 300, 500);
    advance(r.director, 1300, 300);
    expect(r.ball.holder).toBeNull();
    expect(r.state.pendingReceiver).toBeNull();
    expect(r.ball.position.z).toBe(25);
  });

  it.each(['goal', 'saved', 'blocked', 'missed'] as const)('does not let an old pass reception steal a %s shot', result => {
    const r = renderer();
    const passer = r.player('home', 3);
    const shooter = r.player('home', 5);
    const keeper = r.player('away', 0);
    const blocker = r.player('away', 1);
    r.hold(passer);
    const end = result === 'saved' ? event('save', keeper) : result === 'blocked' ? event('block', blocker) : event(result === 'goal' ? 'goal' : 'miss', shooter);
    const action = report([event('pass', passer, shooter), event('shot', shooter, undefined, { durationMs: 800, shotResult: result }), end]);
    r.director.beginAction(action);
    advance(r.director, action.durationMs);
    expect(r.ball.holder?.id).not.toBe(shooter.id);
    expect(r.state.pendingReceiver).toBeNull();
    if (result === 'goal') {
      expect(r.ball.position.z).toBeGreaterThan(PITCH.length / 2);
      expect(r.stadium.netImpact).toHaveBeenCalledOnce();
    }
    if (result === 'saved') {
      expect(r.ball.holder?.id).toBe(keeper.id);
      expect(r.ball.position.y).toBeCloseTo(0.95, 1);
    }
  });

  it('shows the recorded winner controlling an interception and carrying the counter', () => {
    const r = renderer();
    const carrier = r.player('home', 3);
    const winner = r.player('away', 2);
    r.hold(carrier);
    const action = report([event('interception', winner, carrier), event('counter', winner)]);
    r.director.beginAction(action);
    advance(r.director, action.durationMs);
    expect(r.ball.holder?.id).toBe(winner.id);
    expect(r.ball.position.clone().setY(0).distanceTo(winner.position)).toBeLessThan(1.3);
  });
});

describe('chance and set-piece delivery', () => {
  it('shows a cutback arriving at the recorded shooter before the strike', () => {
    const r = renderer();
    const creator = r.player('home', 3);
    const shooter = r.player('home', 5);
    r.hold(creator);
    const action = report([event('through_ball', creator, shooter, { style: 'cutback', durationMs: 1100 }), event('shot', shooter, undefined, { shotResult: 'goal' })]);
    r.director.beginAction(action);
    advance(r.director, 1099);
    expect(r.ball.holder?.id).toBe(shooter.id);
    expect(r.ball.position.clone().setY(0).distanceTo(shooter.position)).toBeLessThan(1.3);
    advance(r.director, action.durationMs, 1099);
    expect(r.ball.holder).toBeNull();
    expect(r.ball.position.z).toBeGreaterThan(PITCH.length / 2);
  });

  it('carries a self-pass instead of kicking the ball away and assigning it back', () => {
    const r = renderer();
    const carrier = r.player('home', 3);
    r.hold(carrier);
    const kick = vi.spyOn(r.ball, 'kick');
    r.director.beginAction(report([event('pass', carrier, carrier)]));
    advance(r.director, 1000);
    expect(kick).not.toHaveBeenCalled();
    expect(r.ball.holder?.id).toBe(carrier.id);
  });
  it.each(['cross', 'corner', 'free_kick'] as const)('delivers a %s to the head once, then redirects it towards goal', style => {
    const r = renderer();
    const creator = r.player('home', 3);
    const shooter = r.player('home', 5);
    r.hold(creator);
    const delivery = style === 'cross' ? event('through_ball', creator, shooter, { style: 'cross', durationMs: 1100 }) : event(style, creator, undefined, { durationMs: 1500 });
    const action = report([delivery, event('header', shooter, undefined, { durationMs: 900, shotResult: 'goal' }), event('goal', shooter)]);
    const kicks: { at: Vector3; to: Vector3 }[] = [];
    const kick = r.ball.kick.bind(r.ball);
    vi.spyOn(r.ball, 'kick').mockImplementation((to, ...args) => { kicks.push({ at: r.ball.position.clone(), to: to.clone() }); kick(to, ...args); });
    r.director.beginAction(action);
    advance(r.director, action.durationMs);
    expect(kicks).toHaveLength(2);
    expect(kicks[0]!.to.y).toBeCloseTo(2.4);
    expect(kicks[1]!.at.y).toBeCloseTo(2.4);
    expect(kicks[1]!.to.z).toBeGreaterThan(PITCH.length / 2);
  });

  it('shows a corner delivery even when the defender wins the aerial duel', () => {
    const r = renderer();
    const taker = r.player('home', 3);
    const winner = r.player('away', 1);
    const action = report([event('corner', taker, undefined, { durationMs: 1400 }), event('clearance', winner)]);
    r.director.beginAction(action);
    advance(r.director, 1399);
    expect(r.ball.position.y).toBeGreaterThan(2.3);
    expect(r.ball.position.clone().setY(0).distanceTo(winner.position)).toBeLessThan(0.1);
    advance(r.director, action.durationMs, 1399);
    expect(Math.abs(r.ball.position.x)).toBeGreaterThan(PITCH.width / 2);
  });

  it.each(['saved', 'blocked'] as const)('sends a %s shot over the goal line when the report awards a corner', result => {
    const r = renderer();
    const shooter = r.player('home', 5);
    const defender = r.player('away', result === 'saved' ? 0 : 1);
    r.hold(shooter);
    const action = report([
      event('shot', shooter, undefined, { durationMs: 800, shotResult: result }),
      event(result === 'saved' ? 'save' : 'block', defender, shooter, { durationMs: 1300 }),
      event('corner', r.player('home', 3), undefined, { durationMs: 1400 }),
      event('clearance', r.player('away', 2)),
    ]);
    r.director.beginAction(action);
    advance(r.director, 2099);
    expect(r.ball.position.z).toBeGreaterThan(PITCH.length / 2);
    expect(r.ball.holder).toBeNull();
    expect(r.state.pendingReceiver).toBeNull();
  });

  it.each(['home', 'away'] as const)('aims %s goals inside the mouth in the away viewer orientation', side => {
    const r = renderer('away');
    const shooter = r.player(side, 5);
    const direction = side === 'away' ? 1 : -1;
    r.hold(shooter);
    r.director.beginAction(report([event('shot', shooter, undefined, { shotResult: 'goal' })], side));
    const goal = r.ball.destination();
    expect(goal.z * direction).toBeGreaterThan(PITCH.length / 2);
    expect(Math.abs(goal.x) + 0.3).toBeLessThan(PITCH.goalWidth / 2);
    expect(goal.y + 0.3).toBeLessThan(PITCH.goalHeight);
  });
});

describe('presentation lifecycle', () => {
  it.each(['foul', 'offside', 'dive'] as const)('stops the ball at its actual position for %s', kind => {
    const r = renderer();
    const carrier = r.player('home', 3);
    r.hold(carrier);
    const stop = kind === 'foul' ? event(kind, r.player('away', 1), carrier, { durationMs: 1500 }) : event(kind, carrier, undefined, { durationMs: 1500 });
    r.director.beginAction(report([stop, event('cards')]));
    advance(r.director, 1000);
    expect(r.ball.holder).toBeNull();
    expect(r.ball.inFlight).toBe(false);
    const at = r.ball.position.clone();
    advance(r.director, 2200, 1000);
    expect(r.ball.position.distanceTo(at)).toBeLessThan(0.01);
  });
  it('reconstructs a partly elapsed action without replaying skipped effects', () => {
    const live = renderer();
    const resumed = renderer();
    const make = (r: ReturnType<typeof renderer>) => report([
      event('long_ball', r.player('home', 3), r.player('home', 5), { durationMs: 1300 }),
      event('dribble', r.player('home', 5), undefined, { durationMs: 1100, style: 'solo' }),
      event('shot', r.player('home', 5), undefined, { durationMs: 800, shotResult: 'goal' }),
      event('goal', r.player('home', 5)),
    ]);
    live.hold(live.player('home', 3));
    resumed.hold(resumed.player('home', 3));
    live.director.beginAction(make(live));
    advance(live.director, 2800);
    resumed.director.beginAction(make(resumed), 2800, 0);
    expect(resumed.ball.position.distanceTo(live.ball.position)).toBeLessThan(0.05);
    expect(resumed.ball.inFlight).toBe(live.ball.inFlight);
    expect(resumed.sfx.kick).not.toHaveBeenCalled();
    expect(resumed.stadium.netImpact).not.toHaveBeenCalled();
  });

  it('keeps event and contact order when a single frame spans an entire action', () => {
    const live = renderer();
    const slow = renderer();
    const action = report([
      event('pass', live.player('home', 3), live.player('home', 5)),
      event('through_ball', live.player('home', 5), live.player('home', 4), { style: 'cross', durationMs: 1100 }),
      event('header', live.player('home', 4), undefined, { shotResult: 'goal', durationMs: 900 }),
      event('goal', live.player('home', 4)),
    ]);
    live.hold(live.player('home', 3));
    slow.hold(slow.player('home', 3));
    live.director.beginAction(action);
    slow.director.beginAction(action);
    advance(live.director, action.durationMs);
    slow.director.update(0.05, action.durationMs);
    expect(slow.ball.position.distanceTo(live.ball.position)).toBeLessThan(0.05);
    expect(slow.stadium.netImpact).toHaveBeenCalledOnce();
    expect(slow.state.pendingReceiver).toBeNull();
  });

  it('reconstructs an already completed goal after reconnecting', () => {
    const r = renderer();
    const action = report([event('pass', r.player('home', 3), r.player('home', 5)), event('shot', r.player('home', 5), undefined, { shotResult: 'goal' }), event('goal', r.player('home', 5))]);
    r.director.sync({ ...r.view, phase: 'resolving', lastAction: action }, 0);
    r.director.beginAction(action, action.durationMs, 0);
    expect(r.ball.position.z).toBeGreaterThan(PITCH.length / 2);
    expect(r.ball.holder).toBeNull();
    expect(r.sfx.kick).not.toHaveBeenCalled();
    expect(r.stadium.netImpact).not.toHaveBeenCalled();
  });

  it('cancels old choreography before the next turn or the break', () => {
    const r = renderer();
    r.hold(r.player('home', 3));
    const action = report([event('through_ball', r.player('home', 3), r.player('home', 5), { style: 'cross' })]);
    r.director.beginAction(action);
    r.director.sync({ ...r.view, turn: 2, attackingSide: 'away', lastAction: action }, 100);
    const kicks = r.sfx.kick.mock.calls.length;
    r.director.sync({ ...r.view, phase: 'halftime', attackingSide: null }, 150);
    advance(r.director, 3000, 150);
    expect(r.state.pendingReceiver).toBeNull();
    expect(r.state.queue).toHaveLength(0);
    expect(r.sfx.kick.mock.calls.length).toBe(kicks);
  });

  it('keeps the next turn on the current clock after an early server phase change', () => {
    const r = renderer();
    r.hold(r.player('home', 3));
    const action = report([event('pass', r.player('home', 3), r.player('home', 5)), event('shot', r.player('home', 5), undefined, { shotResult: 'goal' }), event('goal', r.player('home', 5))]);
    r.director.beginAction(action);
    advance(r.director, 100);
    r.director.endAction(100);
    r.director.sync({ ...r.view, turn: 2, attackingSide: 'away', lastAction: action }, 100);
    r.director.update(0.05, 200);
    expect((r.director as unknown as { now: number }).now).toBe(200);
    expect(r.state.pendingReceiver).toBeNull();
  });

  it('removes each of two dismissed players at their own booking', () => {
    const r = renderer();
    const first = r.player('away', 1);
    const second = r.player('away', 2);
    const carrier = r.player('home', 3);
    const action = report([
      event('foul', first, carrier, { booking: { playerId: first.id, card: 'red' } }),
      event('foul', second, carrier, { booking: { playerId: second.id, card: 'red' } }),
      event('free_kick', carrier),
    ]);
    const resolving = structuredClone(r.view);
    resolving.phase = 'resolving';
    resolving.lastAction = action;
    resolving.teams.away.lineup.slots[1] = resolving.teams.away.lineup.slots[2] = null;
    r.director.sync(resolving, 0);
    r.director.beginAction(action);
    advance(r.director, 900);
    expect(r.actors.has(first.id)).toBe(false);
    expect(r.actors.has(second.id)).toBe(true);
    advance(r.director, 1900, 900);
    expect(r.actors.has(first.id)).toBe(false);
    expect(r.actors.has(second.id)).toBe(false);
  });

  it('keeps a dismissed keeper until the booking and equips the emergency keeper afterwards', () => {
    const r = renderer();
    const keeper = r.player('away', 0);
    const emergency = r.player('away', 1);
    const victim = r.player('home', 5);
    const action = report([event('foul', keeper, victim, { durationMs: 1500, booking: { playerId: keeper.id, card: 'red' } }), event('penalty', victim), event('shot', victim, undefined, { shotResult: 'saved' }), event('save', emergency)]);
    const resolving = structuredClone(r.view);
    resolving.phase = 'resolving';
    resolving.lastAction = action;
    resolving.teams.away.lineup.slots[0] = emergency.id;
    resolving.teams.away.lineup.slots[1] = null;
    resolving.teams.away.players[keeper.id]!.sentOff = true;
    r.director.sync(resolving, 0);
    expect(r.actors.has(keeper.id)).toBe(true);
    expect(r.actors.get(emergency.id)?.isKeeper).toBe(false);
    r.director.beginAction(action);
    advance(r.director, 1400);
    expect(r.actors.has(keeper.id)).toBe(false);
    expect(r.actors.get(emergency.id)?.isKeeper).toBe(true);
    // A new browser reconstructs the same pre-booking lineup from the resolved view.
    const reconnect = renderer();
    reconnect.director.sync(resolving, 0);
    expect(reconnect.actors.get(keeper.id)?.isKeeper).toBe(true);
  });

  it('reveals a partially elapsed HUD event immediately and completes on the original deadline', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const listener = { onStart: vi.fn(), onEvent: vi.fn(), onComplete: vi.fn() };
    const playback = new ActionPlayback(listener);
    const action = report([event('pass'), event('shot'), event('goal')]);
    playback.play(action, 1500);
    expect(listener.onStart).toHaveBeenCalledWith(action, 1500);
    expect(playback.playedIndex).toBe(1);
    expect(listener.onEvent.mock.calls.map(c => c[3])).toEqual([true, false]);
    expect(listener.onEvent.mock.lastCall?.[4]).toBe(500);
    vi.advanceTimersByTime(500);
    expect(listener.onEvent.mock.lastCall?.[0].kind).toBe('goal');
    expect(listener.onEvent.mock.lastCall?.[3]).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(listener.onComplete).toHaveBeenCalledOnce();
  });

  it('keeps the card reveal when a fresh report arrives a few milliseconds late', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const listener = { onStart: vi.fn(), onEvent: vi.fn(), onComplete: vi.fn() };
    new ActionPlayback(listener).play(report([event('cards', undefined, undefined, { durationMs: 1700 })]), 20);
    expect(listener.onEvent.mock.lastCall?.[3]).toBe(false);
    expect(listener.onEvent.mock.lastCall?.[4]).toBe(1680);
  });

  it('plays complete authoritative matches with the recorded participants and no lingering receptions', () => {
    const kinds = new Set<string>();
    for (const seed of [7, 19, 42, 61, 93, 124, 167, 209, 317, 443, 556, 809]) {
      const { match, scheduler } = game(seed);
      const r = renderer();
      const snapshots: MatchView[] = [];
      match.onChange(() => { snapshots.push(structuredClone(match.view('home'))); });
      const bots = (['home', 'away'] as const).map(side => new BotManager(match, side, scheduler, new SeededRng(seed * 31 + side.length)));
      for (const side of ['home', 'away'] as const) match.assignManager(side, { clientId: side, name: side, isBot: true, connected: true });
      scheduler.runAll();
      let now = 0;
      let actionId = 0;
      for (const view of snapshots) {
        r.director.sync(view, now);
        if (view.phase !== 'resolving' || !view.lastAction || view.lastAction.id === actionId) continue;
        const action = view.lastAction;
        actionId = action.id;
        for (const e of action.events) {
          kinds.add(e.kind);
          if (e.actorId) expect(r.actors.has(e.actorId), `missing ${e.kind} actor ${e.actorId}`).toBe(true);
        }
        r.director.beginAction(action);
        advance(r.director, now + action.durationMs, now);
        now += action.durationMs;
        r.director.endAction();
        expect(r.state.pendingReceiver).toBeNull();
        expect(Number.isFinite(r.ball.position.lengthSq())).toBe(true);
        if (action.outcome === 'goal') expect(Math.abs(r.ball.position.z)).toBeGreaterThan(PITCH.length / 2);
        if (action.outcome === 'saved') {
          const save = [...action.events].reverse().find(e => e.kind === 'save');
          expect(r.ball.holder?.id).toBe(save?.actorId);
        }
      }
      bots.forEach(b => b.dispose());
      match.dispose();
    }
    for (const kind of ['pass', 'dribble', 'through_ball', 'long_ball', 'tackle', 'clearance', 'shot', 'save', 'goal', 'corner', 'header']) expect(kinds.has(kind), `missing coverage: ${kind}`).toBe(true);
  }, 30000);
});
