import { MathUtils, Vector3, type Scene } from 'three';
import { getFormation, type Formation, type FormationSlot } from '../../shared/model/formation';
import { otherSide, type ActionReport, type MatchEvent, type MatchPhase, type MatchView, type Side, type TeamView } from '../../shared/model/match';
import type { Sfx } from '../audio/Sfx';
import { BallActor } from './BallActor';
import type { CameraRig } from './CameraRig';
import { PITCH, PitchSpace } from './PitchSpace';
import { PlayerActor } from './PlayerActor';
import { BallPlanner } from './tactics/BallPlanner';
import { TeamShape, type ShapePlayer } from './tactics/TeamShape';

interface TeamInfo {
  view: TeamView;
  formation: Formation;
  slotOf: Map<string, number>;
}

interface Scheduled {
  at: number;
  run: () => void;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

/**
 * Turns abstract match events into choreography: who runs where, where the ball goes.
 * Off the ball every player follows the `TeamShape` (support angles in possession, a compact
 * block out of it); between actions the team on the ball keeps it with `BallPlanner` choices
 * ("the players are playing" while the managers think).
 */
export class MatchDirector {
  private readonly actors = new Map<string, PlayerActor>();
  private readonly ball = new BallActor();
  private readonly space = new PitchSpace('home');
  private readonly teams: Partial<Record<Side, TeamInfo>> = {};
  private readonly queue: Scheduled[] = [];
  private readonly shape = new TeamShape();
  private readonly planner = new BallPlanner();
  private shapePlayers: ShapePlayer<PlayerActor>[] = [];
  private shapeTargets: ReadonlyMap<string, Vector3> = new Map();
  /** A player walking to a dead ball to restart play; they pick it up on arrival. */
  private collector: PlayerActor | null = null;
  private readonly tmp = new Vector3();
  private readonly tmpBall = new Vector3();
  private attackingSide: Side | null = null;
  private phase: MatchPhase = 'lobby';
  private actionRunning = false;
  private preparedTurn = -1;
  private nextBallDecision = 0;
  private pendingReceiver: { actor: PlayerActor; at: number } | null = null;
  private highlighted: PlayerActor[] = [];
  private now = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: CameraRig,
    private readonly sfx: Sfx,
  ) {
    scene.add(this.ball.group, this.ball.shadowMesh);
  }

  // ── State sync ─────────────────────────────────────────────────────────────

  sync(view: MatchView, now: number): void {
    this.now = now;
    this.space.setViewer(view.you);
    this.phase = view.phase;
    const wanted = new Set<string>();

    for (const side of ['home', 'away'] as const) {
      const team = view.teams[side];
      const formation = getFormation(team.lineup.formationId);
      const slotOf = new Map<string, number>();
      team.lineup.slots.forEach((id, index) => { if (id) slotOf.set(id, index); });
      this.teams[side] = { view: team, formation, slotOf };

      for (const [id, slot] of slotOf) {
        wanted.add(id);
        if (this.actors.has(id)) continue;
        const profile = team.squad.find(p => p.id === id);
        if (!profile) continue;
        const isKeeper = slot === 0;
        const actor = new PlayerActor(profile, side, {
          shirt: isKeeper ? team.team.goalkeeperColor : team.team.primaryColor,
          shorts: isKeeper ? '#1b1b1b' : team.team.secondaryColor,
          socks: isKeeper ? team.team.goalkeeperColor : team.team.primaryColor,
        }, team.team.primaryColor);
        const spot = this.shape.restingSpot(formation.slots[slot]!);
        actor.teleport(this.space.toWorld(side, spot.nx, spot.ny, 0, this.tmp));
        this.actors.set(id, actor);
        this.scene.add(actor.group);
      }
    }
    for (const [id, actor] of this.actors) {
      if (wanted.has(id)) continue;
      this.scene.remove(actor.group);
      this.actors.delete(id);
      if (this.ball.holder === actor) this.ball.place(actor.position);
      if (this.collector === actor) this.collector = null;
    }
    this.shapePlayers = [...this.actors.values()]
      .map(actor => ({ actor, slot: this.slotInfo(actor) }))
      .filter((p): p is ShapePlayer<PlayerActor> => p.slot !== null);

    if (view.phase === 'planning' && view.turn !== this.preparedTurn) this.prepareTurn(view);
    if (view.phase === 'halftime' || view.phase === 'fulltime' || view.phase === 'lobby') {
      this.attackingSide = null;
      if (!this.actionRunning) this.ball.place(this.tmp.set(0, 0, 0));
    } else if (view.attackingSide) {
      this.attackingSide = view.attackingSide;
    }
  }

  private prepareTurn(view: MatchView): void {
    this.preparedTurn = view.turn;
    this.actionRunning = false;
    this.clearHighlights();
    for (const actor of this.actors.values()) actor.scriptedUntil = 0;
    const attacking = view.attackingSide;
    if (!attacking) return;
    this.attackingSide = attacking;

    const turnInHalf = view.half === 1 ? view.turn : view.turn - view.turnsPerHalf;
    const kickoff = turnInHalf === 1 || view.lastAction?.outcome === 'goal';
    this.collector = null;
    if (kickoff) {
      const centre = this.tmp.set(0, 0, 0);
      this.ball.place(centre);
      const taker = this.nearest(attacking, centre, ['FWD', 'MID']);
      if (taker) {
        taker.teleport(this.space.toWorld(attacking, 0.03, 0.49));
        this.ball.giveTo(taker);
      }
      this.sfx.whistle(1);
    } else {
      this.restartPlay(attacking);
    }
    this.nextBallDecision = this.now + 1400;
  }

  /**
   * Gets the ball to the team about to attack the way football would: they keep it if they
   * have it, the keeper takes a goal kick, the nearest player takes a throw-in or picks up a
   * loose ball, and a defender still on the ball clears it to them.
   */
  private restartPlay(attacking: Side): void {
    const holder = this.ball.holder;
    if (holder?.side === attacking) return;
    const at = this.ball.destination(this.tmpBall);
    if (holder) {
      // Siege: the defenders win it but can only hack it clear — straight back to the attackers.
      const receiver = this.nearest(attacking, this.space.toWorld(attacking, 0, 0.5), ['MID', 'DEF']);
      if (receiver) this.passTo(receiver, this.targetOf(receiver).clone(), 1000, 4);
      return;
    }
    const team = this.space.toTeam(attacking, at);
    const halfWidth = PITCH.width / 2;
    if (team.ny < 0.01) {
      // Over our own goal line: goal kick.
      const spot = this.space.toWorld(attacking, Math.sign(team.nx || 1) * 0.25, 0.06);
      this.ball.place(spot);
      this.collector = this.keeper(attacking);
    } else if (Math.abs(at.x) > halfWidth || team.ny > 0.99) {
      // Out of play: throw-in on the touchline, or back into play near where it went out.
      const spot = this.tmpBall.set(MathUtils.clamp(at.x, -halfWidth, halfWidth), 0, MathUtils.clamp(at.z, -PITCH.length / 2 + 3, PITCH.length / 2 - 3));
      this.ball.place(spot);
      this.collector = this.nearest(attacking, spot, ['DEF', 'MID', 'FWD']);
    } else {
      this.ball.place(at);
      this.collector = this.nearest(attacking, at, ['DEF', 'MID', 'FWD']);
    }
    if (this.collector) this.run(this.collector, this.ball.position.clone().setY(0), 2500);
  }

  // ── Action playback ────────────────────────────────────────────────────────

  beginAction(report: ActionReport): void {
    this.actionRunning = true;
    this.attackingSide = report.attackingSide;
    this.collector = null;
    const holder = this.ball.holder;
    if (!holder || holder.side !== report.attackingSide) {
      const carrier = this.nearest(report.attackingSide, this.ball.destination(this.tmpBall), ['MID', 'DEF', 'FWD']);
      if (carrier) this.ball.giveTo(carrier);
    }
  }

  endAction(): void {
    this.actionRunning = false;
    this.clearHighlights();
    this.camera.setZoom(1);
  }

  play(event: MatchEvent, index: number, report: ActionReport): void {
    const d = event.durationMs;
    const A = report.attackingSide;
    const actor = this.actor(event.actorId);
    const target = this.actor(event.targetId);
    const next = report.events[index + 1];
    this.highlight(actor, target);

    switch (event.kind) {
      case 'cards':
        this.sfx.card();
        break;

      case 'buildup':
        if (!actor) break;
        if (this.ball.holder !== actor) this.passTo(actor, actor.position.clone(), d * 0.4);
        // Carry it into the most open channel of midfield.
        this.run(actor, this.openSpot(A, this.space.toTeam(A, actor.position).nx * 0.8, 0.44), d);
        break;

      case 'pass':
        if (actor && this.ball.holder !== actor) this.ball.giveTo(actor);
        // Played into space in front of the receiver, where no defender is waiting.
        if (target) this.passTo(target, this.openSpot(A, this.space.toTeam(A, target.position).nx * 0.85, 0.64), d * 0.8);
        break;

      case 'dribble': {
        if (!actor) break;
        if (this.ball.holder !== actor) this.ball.giveTo(actor);
        const at = this.space.toTeam(actor.side, actor.position);
        this.run(actor, this.space.toWorld(actor.side, at.nx * 0.8, Math.min(0.86, at.ny + 0.15)), d);
        if (target) {
          this.run(target, actor.position.clone(), d * 0.5);
          this.later(d * 0.45, () => target.setPose('fallen', this.now, 650));
        }
        break;
      }

      case 'tackle':
        if (!actor) break;
        this.run(actor, (target ?? this.ball.holder ?? actor).position.clone(), d * 0.6);
        this.later(d * 0.55, () => {
          this.ball.giveTo(actor);
          target?.setPose('fallen', this.now, 900);
          this.sfx.kick(0.4);
        });
        break;

      case 'interception': {
        if (!actor) break;
        const from = this.ball.position.clone();
        const point = from.lerp(actor.position, 0.6).setY(0);
        this.passTo(actor, point, d * 0.5);
        break;
      }

      case 'counter':
        if (!actor) break;
        if (this.ball.holder !== actor) this.ball.giveTo(actor);
        this.run(actor, this.forward(actor, 0.22), d);
        break;

      case 'long_ball':
        if (actor) this.ball.giveTo(actor);
        if (target) this.passTo(target, this.openSpot(A, this.space.toTeam(A, target.position).nx * 0.7, 0.76), d * 0.85, 7);
        break;

      case 'through_ball': {
        if (actor && this.ball.holder !== actor && actor !== target) this.ball.giveTo(actor);
        if (!target) break;
        // Into the runner's channel, in behind the last defender.
        const channel = MathUtils.clamp(this.space.toTeam(A, target.position).nx * 0.55, -0.4, 0.4);
        const spot = this.space.toWorld(A, channel, 0.82);
        this.passTo(target, spot, d * 0.8);
        const defender = this.nearest(otherSide(A), spot, ['DEF', 'MID']);
        if (defender) this.run(defender, spot.clone().add(this.tmp.set(rand(-1.5, 1.5), 0, 1.5 * this.space.direction(A))), d);
        break;
      }

      case 'clearance':
        if (actor) this.run(actor, this.ball.destination(), d * 0.4);
        this.later(d * 0.4, () => {
          const out = next?.kind === 'corner'
            ? this.space.toWorld(A, sign() * 0.45, 1.06, 0.3)
            : this.space.toWorld(A, sign() * 0.95, rand(0.35, 0.5), 0.3);
          this.ball.kick(out, this.now, d * 0.55, next?.kind === 'corner' ? 2 : 7);
          this.sfx.kick(0.7);
        });
        break;

      case 'foul':
        if (actor && target) this.run(actor, target.position.clone(), d * 0.4);
        this.later(d * 0.35, () => {
          target?.setPose('fallen', this.now, 1300);
          if (target) this.ball.place(target.feet(this.tmp));
          this.sfx.whistle(1);
        });
        break;

      case 'offside':
        if (actor) this.run(actor, this.forward(actor, 0.12), d * 0.5);
        this.later(d * 0.3, () => {
          this.ball.place(this.ball.position);
          this.sfx.whistle(2);
        });
        break;

      case 'shot':
      case 'header':
        this.shoot(event, report, index, actor);
        break;

      case 'save':
        this.save(actor, d, next?.kind === 'corner', A);
        break;

      case 'block':
        this.later(d * 0.05, () => {
          const deflect = this.ball.position.clone().add(this.tmp.set(rand(3, 6) * sign(), 0, -2 * this.space.direction(A)));
          this.ball.kick(deflect, this.now, d * 0.6, 1.5);
          this.sfx.kick(0.5);
        });
        break;

      case 'miss':
        this.sfx.roar(1.2, 0.35);
        break;

      case 'goal':
        this.celebrate(A, actor, d);
        break;

      case 'corner':
        this.setPieceCorner(A, actor, d + (next?.durationMs ?? 0) + 600);
        break;

      case 'free_kick':
        this.setPieceFreeKick(A, actor, d + (next?.durationMs ?? 0) + 600);
        break;

      case 'penalty':
        this.setPiecePenalty(A, actor, d + (next?.durationMs ?? 0) + 600);
        break;

      case 'dive':
        if (actor) this.run(actor, this.forward(actor, 0.06), d * 0.3);
        this.later(d * 0.3, () => {
          actor?.setPose('fallen', this.now, 1300);
          this.sfx.whistle(1);
        });
        break;

      case 'kickoff':
      case 'whistle':
        this.sfx.whistle(event.kind === 'whistle' ? 3 : 1);
        break;
    }
  }

  // ── Frame update ───────────────────────────────────────────────────────────

  update(dt: number, now: number): void {
    this.now = now;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const item = this.queue[i]!;
      if (now >= item.at) {
        this.queue.splice(i, 1);
        item.run();
      }
    }
    if (this.pendingReceiver && now >= this.pendingReceiver.at && !this.ball.inFlight) {
      this.ball.giveTo(this.pendingReceiver.actor);
      this.pendingReceiver = null;
    }
    if (this.collector && !this.ball.holder && !this.ball.inFlight && this.collector.position.distanceTo(this.ball.position) < 1.3) {
      this.ball.giveTo(this.collector);
      this.collector = null;
      this.nextBallDecision = Math.max(this.nextBallDecision, now + 700);
    }
    if (!this.actionRunning && this.phase === 'planning' && now > this.nextBallDecision) this.playOnTheBall();

    this.shapeTargets = this.shape.compute({
      space: this.space,
      players: this.shapePlayers,
      ball: this.ball.destination(this.tmpBall),
      holder: this.ball.holder,
      possession: this.possession(),
      mentality: { home: this.teams.home?.view.mentality ?? 0, away: this.teams.away?.view.mentality ?? 0 },
    });
    for (const actor of this.actors.values()) {
      if (now > actor.scriptedUntil) actor.moveTo(this.targetOf(actor), now);
      actor.update(dt, now, this.ball.position);
    }
    this.ball.update(dt, now);
    this.camera.update(dt, now, this.ball.position);
  }

  // ── Choreography helpers ───────────────────────────────────────────────────

  private shoot(event: MatchEvent, report: ActionReport, index: number, shooter: PlayerActor | null): void {
    const A = report.attackingSide;
    const d = event.durationMs;
    const dir = this.space.direction(A);
    const goalLine = (PITCH.length / 2) * dir;
    const keeper = this.keeper(otherSide(A));
    const blockEvent = report.events[index + 1]?.kind === 'block' ? report.events[index + 1] : undefined;
    const blocker = this.actor(blockEvent?.actorId);

    let aim: Vector3;
    switch (event.shotResult) {
      case 'goal':
        aim = new Vector3(sign() * rand(0.7, 2.1), rand(0.35, 1.7), goalLine + 0.9 * dir);
        break;
      case 'saved':
        aim = new Vector3((keeper?.position.x ?? 0) + sign() * rand(0.4, 1.3), rand(0.4, 1.4), goalLine - 0.3 * dir);
        break;
      case 'blocked':
        aim = blocker ? blocker.position.clone().setY(0.8) : new Vector3(0, 0.5, goalLine - 6 * dir);
        if (blocker && shooter) this.run(blocker, shooter.position.clone().lerp(this.space.goalMouth(A), 0.25), d * 0.6);
        break;
      default:
        aim = Math.random() < 0.5
          ? new Vector3(sign() * rand(3.1, 5), rand(0.3, 1.4), goalLine + 2.5 * dir)
          : new Vector3(sign() * rand(0, 2), rand(2.7, 3.6), goalLine + 2.5 * dir);
    }

    const strike = (durationMs: number) => {
      this.ball.kick(aim, this.now, durationMs, event.kind === 'header' ? 0.6 : rand(0.2, 1.2), sign() * rand(0, 1.2));
      this.sfx.kick(1);
    };

    if (event.kind === 'header' && shooter) {
      const head = shooter.position.clone().setY(2.4);
      this.ball.kick(head, this.now, d * 0.45, 3);
      this.later(d * 0.45, () => strike(d * 0.5));
    } else {
      if (shooter && this.ball.holder !== shooter && !this.ball.inFlight) this.ball.giveTo(shooter);
      strike(d * 0.85);
    }
  }

  private save(keeper: PlayerActor | null, d: number, toCorner: boolean, attacking: Side): void {
    if (!keeper) return;
    const ballAt = this.ball.destination();
    const angle = keeper.group.rotation.y;
    const lateral = (ballAt.x - keeper.position.x) * Math.cos(angle) - (ballAt.z - keeper.position.z) * Math.sin(angle);
    keeper.moveTo(this.tmp.set(MathUtils.clamp(ballAt.x, -2.3, 2.3), 0, keeper.position.z), this.now, d);
    keeper.setPose('dive', this.now, 1100, lateral >= 0 ? 1 : -1);
    this.later(d * 0.3, () => {
      if (toCorner) {
        const out = this.space.toWorld(attacking, Math.sign(ballAt.x || 1) * 0.35, 1.07, 0.5);
        this.ball.kick(out, this.now, d * 0.5, 2);
      } else {
        this.ball.giveTo(keeper);
      }
      this.sfx.roar(1.4, 0.5);
    });
  }

  private celebrate(side: Side, scorer: PlayerActor | null, d: number): void {
    this.sfx.roar(3.2, 1);
    this.later(250, () => this.sfx.whistle(1));
    this.camera.shake(this.now, 700, 1.4);
    this.camera.setZoom(0.85);
    const flagSide = scorer ? Math.sign(this.space.toTeam(side, scorer.position).nx) || 1 : 1;
    const flag = this.space.toWorld(side, 0.85 * flagSide, 0.93);
    for (const actor of this.actors.values()) {
      if (actor.side === side && this.slotOf(actor) !== 0) {
        const spot = actor === scorer ? flag : flag.clone().add(this.tmp.set(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)));
        this.run(actor, spot, d + 800);
        this.later(rand(300, 900), () => actor.setPose('celebrate', this.now, d));
      } else if (actor.side !== side) {
        actor.scriptedUntil = this.now + d;
      }
    }
  }

  private setPieceCorner(A: Side, taker: PlayerActor | null, holdMs: number): void {
    const s = sign();
    const flag = this.space.toWorld(A, 1.02 * s, 1.0);
    this.ball.place(flag);
    if (taker) {
      taker.teleport(this.space.toWorld(A, 1.05 * s, 1.02));
      taker.scriptedUntil = this.now + holdMs;
    }
    this.packTheBox(A, taker, holdMs);
  }

  private setPieceFreeKick(A: Side, taker: PlayerActor | null, holdMs: number): void {
    const nx = rand(-0.35, 0.35);
    const spot = this.space.toWorld(A, nx, 0.72);
    this.ball.place(spot);
    if (taker) {
      taker.teleport(this.space.toWorld(A, nx, 0.69));
      taker.scriptedUntil = this.now + holdMs;
    }
    this.packTheBox(A, taker, holdMs);
    const wall = this.actorsOf(otherSide(A)).filter(a => this.slotOf(a) !== 0).slice(0, 2);
    wall.forEach((actor, i) => this.run(actor, this.space.toWorld(A, nx * 0.7 + (i - 0.5) * 0.06, 0.8), holdMs));
  }

  private setPiecePenalty(A: Side, taker: PlayerActor | null, holdMs: number): void {
    const spotNy = 1 - PITCH.penaltySpot / PITCH.length;
    this.ball.place(this.space.toWorld(A, 0, spotNy));
    for (const actor of this.actors.values()) {
      if (actor === taker) {
        actor.teleport(this.space.toWorld(A, -0.05, spotNy - 0.05));
        actor.scriptedUntil = this.now + holdMs;
      } else if (actor.side !== A && this.slotOf(actor) === 0) {
        actor.teleport(this.space.toWorld(A, 0, 0.995));
        actor.scriptedUntil = this.now + holdMs;
      } else {
        this.run(actor, this.space.toWorld(A, rand(-0.7, 0.7), rand(0.6, 0.66)), holdMs);
      }
    }
  }

  /** Attackers attack the box, defenders mark them, the keeper guards the line. */
  private packTheBox(A: Side, except: PlayerActor | null, holdMs: number): void {
    const attackers = this.actorsOf(A).filter(a => a !== except && this.slotOf(a) !== 0);
    attackers.forEach((actor, i) => {
      const nx = -0.3 + (0.6 * i) / Math.max(1, attackers.length - 1) + rand(-0.05, 0.05);
      const spot = this.space.toWorld(A, nx, rand(0.82, 0.9));
      this.run(actor, spot, holdMs);
      const marker = this.actorsOf(otherSide(A)).filter(a => this.slotOf(a) !== 0)[i];
      if (marker) this.run(marker, spot.clone().add(this.tmp.set(rand(-0.6, 0.6), 0, 1.1 * this.space.direction(A))), holdMs);
    });
    const keeper = this.keeper(otherSide(A));
    if (keeper) this.run(keeper, this.space.toWorld(A, 0, 0.985), holdMs);
  }

  /** The player on the ball decides: pass, carry it into space, or keep it a moment longer. */
  private playOnTheBall(): void {
    const side = this.attackingSide;
    const holder = this.ball.holder;
    if (!side || !holder || holder.side !== side || this.ball.inFlight) {
      this.nextBallDecision = this.now + 300;
      return;
    }
    const holderSlot = this.slotInfo(holder);
    const context = {
      space: this.space,
      side,
      holder,
      holderRole: holderSlot?.role ?? 'MID',
      teammates: this.shapePlayers
        .filter(p => p.actor.side === side && p.actor !== holder)
        .map(p => ({ actor: p.actor, slot: p.slot, target: this.targetOf(p.actor) })),
      opponents: this.actorsOf(otherSide(side)),
      mentality: this.teams[side]?.view.mentality ?? 0,
    } as const;
    const plan = this.planner.plan(context);
    switch (plan.kind) {
      case 'pass':
        this.passTo(plan.receiver, plan.point, plan.durationMs, plan.height);
        break;
      case 'carry':
        this.run(holder, plan.point, plan.durationMs);
        break;
      case 'hold':
        break;
    }
    this.nextBallDecision = this.now + (plan.kind === 'pass' ? plan.durationMs : plan.kind === 'carry' ? plan.durationMs * 0.7 : 0) + this.planner.thinkingTime(context);
  }

  /** Sends the ball to `point` and makes `receiver` run there to collect it. */
  private passTo(receiver: PlayerActor, point: Vector3, durationMs: number, height = 0): void {
    this.ball.kick(point.clone().setY(0.3), this.now, durationMs, height);
    this.run(receiver, point, durationMs + 400);
    this.pendingReceiver = { actor: receiver, at: this.now + durationMs };
    this.sfx.kick(0.45);
  }

  private run(actor: PlayerActor, point: Vector3, durationMs: number): void {
    actor.moveTo(point, this.now, durationMs);
  }

  private later(delayMs: number, run: () => void): void {
    this.queue.push({ at: this.now + delayMs, run });
  }

  /** Where the team shape wants this player right now. */
  private targetOf(actor: PlayerActor): Vector3 {
    return this.shapeTargets.get(actor.id) ?? actor.position;
  }

  /** The side on the ball: whoever holds it, whoever it's flying to, else the side due to attack. */
  private possession(): Side | null {
    if (this.phase === 'halftime' || this.phase === 'fulltime' || this.phase === 'lobby') return null;
    return this.ball.holder?.side ?? this.pendingReceiver?.actor.side ?? this.collector?.side ?? this.attackingSide;
  }

  /**
   * The point near (nx, ny) in `side`'s team space that is furthest from any opponent —
   * where a pass should be played or a run should end.
   */
  private openSpot(side: Side, nx: number, ny: number, out = new Vector3()): Vector3 {
    const opponents = this.actorsOf(otherSide(side));
    const candidate = new Vector3();
    let bestScore = -Infinity;
    for (const dx of [-0.24, -0.12, 0, 0.12, 0.24]) {
      for (const dy of [-0.05, 0, 0.05]) {
        this.space.toWorld(side, MathUtils.clamp(nx + dx, -0.9, 0.9), MathUtils.clamp(ny + dy, 0.05, 0.92), 0, candidate);
        let room = 12;
        for (const opponent of opponents) room = Math.min(room, opponent.position.distanceTo(candidate));
        // Prefer open grass, but don't wander far from the intended spot.
        const score = room - Math.hypot(dx * 14, dy * 48) * 0.35;
        if (score > bestScore) {
          bestScore = score;
          out.copy(candidate);
        }
      }
    }
    return out;
  }

  private slotInfo(actor: PlayerActor): FormationSlot | null {
    const index = this.slotOf(actor);
    const info = this.teams[actor.side];
    return index !== undefined && info ? info.formation.slots[index] ?? null : null;
  }

  private forward(actor: PlayerActor, amount: number): Vector3 {
    const at = this.space.toTeam(actor.side, actor.position);
    return this.space.toWorld(actor.side, at.nx, Math.min(0.92, at.ny + amount));
  }

  private actor(id: string | undefined): PlayerActor | null {
    return id ? this.actors.get(id) ?? null : null;
  }

  private actorsOf(side: Side): PlayerActor[] {
    return [...this.actors.values()].filter(a => a.side === side);
  }

  private slotOf(actor: PlayerActor): number | undefined {
    return this.teams[actor.side]?.slotOf.get(actor.id);
  }

  private keeper(side: Side): PlayerActor | null {
    return this.actorsOf(side).find(a => this.slotOf(a) === 0) ?? null;
  }

  private nearest(side: Side, point: Vector3, roles: string[]): PlayerActor | null {
    const info = this.teams[side];
    let best: PlayerActor | null = null;
    for (const actor of this.actorsOf(side)) {
      const index = this.slotOf(actor);
      if (index === undefined || !info || !roles.includes(info.formation.slots[index]!.role)) continue;
      if (!best || actor.position.distanceTo(point) < best.position.distanceTo(point)) best = actor;
    }
    return best;
  }

  private highlight(...actors: (PlayerActor | null)[]): void {
    this.clearHighlights();
    for (const actor of actors) {
      if (!actor) continue;
      actor.setHighlighted(true);
      this.highlighted.push(actor);
    }
  }

  private clearHighlights(): void {
    for (const actor of this.highlighted) actor.setHighlighted(false);
    this.highlighted = [];
  }
}
