import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getFormation, type FormationId } from '../src/shared/model/formation';
import type { Side } from '../src/shared/model/match';
import { PitchSpace } from '../src/client/render/PitchSpace';
import { BallPlanner } from '../src/client/render/tactics/BallPlanner';
import { TeamShape, type Mover, type ShapeContext, type ShapePlayer } from '../src/client/render/tactics/TeamShape';

const space = new PitchSpace('home');

function fakeActor(id: string, side: Side, position: Vector3): Mover {
  return { id, side, position };
}

/** A team standing on its formation spots, at (ny + shift) in its own team space. */
function team(side: Side, formationId: FormationId, shift = 0): ShapePlayer[] {
  return getFormation(formationId).slots.map((slot, i) => ({
    actor: fakeActor(`${side}-${i}`, side, space.toWorld(side, slot.x, Math.min(0.95, slot.y + shift))),
    slot,
  }));
}

function context(players: ShapePlayer[], ball: Vector3, possession: Side, holder: Mover | null, mentality = { home: 0, away: 0 }): ShapeContext {
  return { space, players, ball, holder, possession, mentality };
}

/** Lets the players walk to their targets a few times, so the shape settles. */
function settle(shape: TeamShape, ctx: ShapeContext, rounds = 6): ReadonlyMap<string, Vector3> {
  let targets = shape.compute(ctx);
  for (let i = 0; i < rounds; i++) {
    for (const p of ctx.players) p.actor.position.copy(targets.get(p.actor.id) ?? p.actor.position);
    targets = shape.compute(ctx);
  }
  return targets;
}

describe('team shape', () => {
  it('keeps defenders goal-side of the ball, with exactly one player closing it down', () => {
    const players = [...team('home', '2-2-1', 0.15), ...team('away', '2-2-1')];
    const holder = players.find(p => p.actor.side === 'home' && p.slot.role === 'MID')!.actor;
    const ball = holder.position.clone();
    const targets = settle(new TeamShape(), context(players, ball, 'home', holder));

    const defenders = players.filter(p => p.actor.side === 'away' && p.slot.role !== 'GK');
    const pressers = defenders.filter(p => targets.get(p.actor.id)!.distanceTo(ball) < 3);
    expect(pressers).toHaveLength(1);

    const ballDepth = space.toTeam('away', ball).ny;
    for (const p of defenders) {
      if (pressers.includes(p) || p.slot.role === 'FWD') continue;
      expect(space.toTeam('away', targets.get(p.actor.id)!).ny).toBeLessThan(ballDepth);
    }
  });

  it('never leaves a forward offside while the team builds up', () => {
    const players = [...team('home', '1-2-2', 0.1), ...team('away', '3-1-1')];
    const holder = players.find(p => p.actor.side === 'home' && p.slot.role === 'DEF')!.actor;
    const ctx = context(players, holder.position.clone(), 'home', holder);
    const targets = settle(new TeamShape(), ctx);

    const opponentDepths = players
      .filter(p => p.actor.side === 'away')
      .map(p => space.toTeam('home', p.actor.position).ny)
      .sort((a, b) => b - a);
    const offsideLine = Math.max(0.5, opponentDepths[1]!);
    for (const p of players.filter(p => p.actor.side === 'home' && p.slot.role === 'FWD')) {
      expect(space.toTeam('home', targets.get(p.actor.id)!).ny).toBeLessThanOrEqual(offsideLine + 1e-6);
    }
  });

  it('spreads the team out so teammates do not crowd each other', () => {
    const players = [...team('home', '1-3-1', 0.1), ...team('away', '2-2-1')];
    const holder = players.find(p => p.actor.side === 'home' && p.slot.role === 'MID')!.actor;
    const ctx = context(players, holder.position.clone(), 'home', holder);
    const targets = settle(new TeamShape(), ctx);
    const outfield = players.filter(p => p.actor.side === 'home' && p.slot.role !== 'GK' && p.actor !== holder);
    for (let i = 0; i < outfield.length; i++) {
      for (let j = i + 1; j < outfield.length; j++) {
        expect(targets.get(outfield[i]!.actor.id)!.distanceTo(targets.get(outfield[j]!.actor.id)!)).toBeGreaterThan(4.5);
      }
    }
  });

  it('sits deeper with a defensive mentality and higher with an attacking one', () => {
    const depth = (mentality: number) => {
      const players = [...team('home', '2-2-1', 0.1), ...team('away', '2-2-1')];
      const holder = players.find(p => p.actor.side === 'home' && p.slot.role === 'MID')!.actor;
      const targets = new TeamShape().compute(context(players, holder.position.clone(), 'home', holder, { home: 0, away: mentality }));
      const block = players.filter(p => p.actor.side === 'away' && p.slot.role !== 'GK');
      return block.reduce((sum, p) => sum + space.toTeam('away', targets.get(p.actor.id)!).ny, 0) / block.length;
    };
    expect(depth(-100)).toBeLessThan(depth(0));
    expect(depth(100)).toBeGreaterThan(depth(0));
  });
});

describe('ball planner', () => {
  it('passes to the free teammate, not the one with a defender in the lane', () => {
    const holder = fakeActor('h', 'home', space.toWorld('home', 0, 0.4));
    const free = fakeActor('free', 'home', space.toWorld('home', -0.6, 0.55));
    const marked = fakeActor('marked', 'home', space.toWorld('home', 0.6, 0.55));
    const blocker = fakeActor('blocker', 'away', space.toWorld('home', 0.3, 0.48));
    const marker = fakeActor('marker', 'away', space.toWorld('home', 0.62, 0.57));
    const chaser = fakeActor('chaser', 'away', space.toWorld('home', 0, 0.36));
    const slot = getFormation('2-2-1').slots[3]!;
    const planner = new BallPlanner();
    for (let i = 0; i < 20; i++) {
      const plan = planner.plan({
        space,
        side: 'home',
        holder,
        holderRole: 'MID',
        teammates: [free, marked].map(actor => ({ actor, slot, target: actor.position })),
        opponents: [blocker, marker, chaser],
        mentality: 0,
      });
      expect(plan.kind).toBe('pass');
      if (plan.kind === 'pass') expect(plan.receiver.id).toBe('free');
    }
  });
});
