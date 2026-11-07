import { MathUtils, Vector3, type Scene } from 'three';
import { getFormation, type Formation, type FormationSlot } from '../../shared/model/formation';
import { otherSide, type ActionReport, type MatchEvent, type MatchPhase, type MatchView, type Side, type TeamView } from '../../shared/model/match';
import type { Sfx } from '../audio/Sfx';
import { BallActor, type BallControl } from './BallActor';
import type { CameraRig } from './CameraRig';
import { PITCH, PitchSpace } from './PitchSpace';
import { PlayerActor } from './PlayerActor';
import type { StadiumEffects } from './stadium/Stadium';
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

/** How long a team that just lost the ball sprints back into shape. */
const RECOVERY_MS = 2600;

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
  private lastPossession: Side | null = null;
  private pendingReceiver: { actor: PlayerActor; motionId: number; control: BallControl; onControl?: () => void } | null = null;
  private highlighted: PlayerActor[] = [];
  private now = 0;
  private action: ActionReport | null = null;
  private actionEndsAt = 0;
  private seeking = false;
  private view: MatchView | null = null;
  private readonly dismissed = new Set<string>();
  private advancing = false;

  constructor(
    private readonly scene: Scene,
    private readonly camera: CameraRig,
    private readonly sfx: Sfx,
    private readonly stadium: StadiumEffects,
  ) {
    scene.add(this.ball.group, this.ball.shadowMesh);
  }

  // ── State sync ─────────────────────────────────────────────────────────────

  sync(view: MatchView, now: number): void {
    this.advance(now);
    this.view = view;
    this.space.setViewer(view.you);
    this.phase = view.phase;
    this.stadium.setTeamColors(view.teams.home.team.primaryColor, view.teams.away.team.primaryColor);
    const wanted = new Set<string>();

    for (const side of ['home', 'away'] as const) {
      const team = view.teams[side];
      const formation = getFormation(team.lineup.formationId);
      let slotOf = new Map<string, number>();
      team.lineup.slots.forEach((id, index) => { if (id) slotOf.set(id, index); });
      // The server has already applied the whole action. Keep a red-carded actor until
      // the foul/dive is shown, including when reconstructing an action after reconnect.
      const pendingReds = view.phase === 'resolving'
        ? view.lastAction?.events.filter(e => e.booking?.card === 'red' && !this.dismissed.has(e.booking.playerId)) ?? []
        : [];
      for (const event of pendingReds) {
        const id = event.booking!.playerId;
        const profile = team.squad.find(p => p.id === id);
        if (!profile) continue;
        const previous = this.teams[side]?.slotOf;
        if (previous?.has(id)) {
          slotOf = new Map(previous);
        } else if (profile.position === 'GK') {
          const emergency = [...slotOf].find(([, slot]) => slot === 0)?.[0];
          if (emergency) {
            const free = formation.slots.findIndex((s, i) => i > 0 && ![...slotOf.values()].includes(i) && s.role === team.squad.find(p => p.id === emergency)?.position);
            slotOf.set(emergency, free > 0 ? free : formation.slots.findIndex((_, i) => i > 0 && ![...slotOf.values()].includes(i)));
          }
          slotOf.set(id, 0);
        } else {
          const free = formation.slots.findIndex((_, i) => i > 0 && ![...slotOf.values()].includes(i));
          if (free > 0) slotOf.set(id, free);
        }
      }
      this.teams[side] = { view: team, formation, slotOf };

      for (const [id, slot] of slotOf) {
        wanted.add(id);
        const old = this.actors.get(id);
        if (old && old.isKeeper === (slot === 0)) continue;
        const profile = team.squad.find(p => p.id === id);
        if (!profile) continue;
        const isKeeper = slot === 0;
        const actor = new PlayerActor(profile, side, {
          shirt: isKeeper ? team.team.goalkeeperColor : team.team.primaryColor,
          shorts: isKeeper ? '#1b1b1b' : team.team.secondaryColor,
          socks: isKeeper ? team.team.goalkeeperColor : team.team.primaryColor,
          gloves: isKeeper ? '#f4f4f4' : undefined,
        }, team.team.primaryColor);
        const spot = this.shape.restingSpot(formation.slots[slot]!);
        actor.teleport(old?.position ?? this.space.toWorld(side, spot.nx, spot.ny, 0, this.tmp));
        if (old) {
          this.scene.remove(old.group);
          if (this.ball.holder === old) this.ball.stop();
          if (this.pendingReceiver?.actor === old) this.pendingReceiver = null;
        }
        this.actors.set(id, actor);
        this.scene.add(actor.group);
      }
    }
    for (const [id, actor] of this.actors) {
      if (wanted.has(id)) continue;
      this.scene.remove(actor.group);
      this.actors.delete(id);
      if (this.ball.holder === actor) this.ball.stop();
      if (this.collector === actor) this.collector = null;
      if (this.pendingReceiver?.actor === actor) this.pendingReceiver = null;
    }
    this.shapePlayers = [...this.actors.values()]
      .map(actor => ({ actor, slot: this.slotInfo(actor) }))
      .filter((p): p is ShapePlayer<PlayerActor> => p.slot !== null);

    if (view.phase === 'planning' && view.turn !== this.preparedTurn) this.prepareTurn(view);
    if (view.phase === 'halftime' || view.phase === 'fulltime' || view.phase === 'lobby') {
      this.attackingSide = null;
      if (!this.actionRunning) this.resetChoreography();
    } else if (view.attackingSide) {
      this.attackingSide = view.attackingSide;
    }
  }

  private prepareTurn(view: MatchView): void {
    this.preparedTurn = view.turn;
    this.actionRunning = false;
    this.resetChoreography();
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
      for (const player of this.shapePlayers) {
        const spot = this.shape.restingSpot(player.slot);
        player.actor.teleport(this.space.toWorld(player.actor.side, spot.nx, spot.ny));
      }
      this.ball.place(centre);
      const taker = this.nearest(attacking, centre, ['FWD', 'MID']);
      if (taker) {
        taker.teleport(this.space.toWorld(attacking, 0.03, 0.49));
        this.ball.giveTo(taker);
      }
      this.effect(() => this.sfx.whistle(1));
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
    const at = this.ball.position.clone();
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

  beginAction(report: ActionReport, offsetMs = 0, now = this.now): void {
    this.advance(now);
    this.resetChoreography();
    this.actionRunning = true;
    this.action = report;
    this.attackingSide = report.attackingSide;
    this.collector = null;
    const elapsed = MathUtils.clamp(offsetMs, 0, report.durationMs);
    this.now = now - elapsed;
    this.actionEndsAt = this.now + report.durationMs;
    let at = 0;
    for (const [index, event] of report.events.entries()) {
      this.later(at, () => this.play(event, index, report));
      at += event.durationMs;
    }
    this.seeking = elapsed > 0;
    this.advance(now);
    this.seeking = false;
  }

  endAction(now = this.now): void {
    const forced = this.action !== null && now < this.actionEndsAt;
    if (this.action) {
      this.seeking = forced;
      this.advance(Math.max(now, this.actionEndsAt));
      this.seeking = false;
    }
    // Fast-forwarding a finished server action must not move the next turn's clock
    // into the future or leave poses/runs waiting for timestamps from that seek.
    this.now = now;
    this.action = null;
    this.actionRunning = false;
    this.queue.length = 0;
    this.pendingReceiver = null;
    if (forced) {
      this.resetChoreography();
      for (const actor of this.actors.values()) actor.setPose('stand', now, 0);
      this.camera.shake(now, 0, 0);
    }
    this.clearHighlights();
    this.camera.setZoom(1);
  }

  play(event: MatchEvent, index: number, report: ActionReport): void {
    const d = event.durationMs;
    const endsAt = this.now + d;
    const A = report.attackingSide;
    const actor = this.actor(event.actorId);
    const target = this.actor(event.targetId);
    const next = report.events[index + 1];
    this.highlight(actor, target);
    if (event.booking?.card === 'red') {
      const id = event.booking.playerId;
      this.later(d * 0.85, () => this.dismiss(id));
    }

    switch (event.kind) {
      case 'cards':
        this.effect(() => this.sfx.card());
        break;

      case 'buildup':
        if (!actor) break;
        this.withBall(actor, d * 0.35, () => {
          this.run(actor, this.openSpot(A, this.space.toTeam(A, actor.position).nx * 0.8, 0.44), d * 0.6);
        });
        break;

      case 'pass':
        if (!target) break;
        this.withBall(actor, d * 0.25, () => {
          const ny = event.style === 'long_shot' ? 0.7 : 0.64;
          const point = this.openSpot(A, this.space.toTeam(A, target.position).nx * 0.8, ny);
          if (actor === target) this.run(target, point, d * 0.7);
          else this.passTo(target, point, d * 0.65);
        });
        break;

      case 'dribble': {
        if (!actor) break;
        this.withBall(actor, d * 0.25, () => {
          this.run(actor, this.forward(actor, 0.15), d * 0.7);
          if (target) {
            this.run(target, actor.position.clone(), d * 0.5);
            this.later(d * 0.45, () => {
              if (target.position.distanceTo(actor.position) < 2.5) target.setPose('fallen', this.now, 650);
            });
          }
        });
        break;
      }

      case 'tackle':
        if (!actor) break;
        this.passTo(actor, this.ball.position.clone().setY(0), d * 0.6, 0, () => {
          actor.setPose('tackle', this.now, 400);
          if (target && target.position.distanceTo(actor.position) < 3) target.setPose('fallen', this.now, 900);
        });
        break;

      case 'interception': {
        if (!actor) break;
        this.passTo(actor, this.ball.position.clone().setY(0), d * 0.65);
        break;
      }

      case 'counter':
        if (!actor) break;
        this.withBall(actor, d * 0.25, () => this.run(actor, this.forward(actor, 0.22), d * 0.7));
        break;

      case 'long_ball':
        if (target) this.withBall(actor, d * 0.25, () => {
          this.passTo(target, this.openSpot(A, this.space.toTeam(A, target.position).nx * 0.7, 0.76), d * 0.7, 5);
        });
        break;

      case 'through_ball': {
        if (!target) break;
        this.withBall(actor, d * 0.2, () => {
          if (actor === target) this.run(target, this.forward(target, 0.15), d * 0.75);
          else if (event.style === 'cross' && actor) this.cross(A, actor, target, endsAt - this.now);
          else if (event.style === 'cutback' && actor) this.cutback(A, actor, target, d * 0.75);
          else {
            const channel = MathUtils.clamp(this.space.toTeam(A, target.position).nx * 0.55, -0.4, 0.4);
            const spot = this.space.toWorld(A, channel, 0.82);
            this.passTo(target, spot, d * 0.75);
            this.trackRunner(A, target.target, d);
          }
        });
        break;
      }

      case 'clearance': {
        const clear = () => {
          if (next?.kind === 'counter' && actor) {
            this.passTo(actor, this.forward(actor, 0.1), d * 0.5, 1.5);
            return;
          }
          const out = next?.kind === 'corner'
            ? this.space.toWorld(A, sign() * 0.45, 1.06, 0.3)
            : this.space.toWorld(A, sign() * (PITCH.width / 2 + 1) / 14, rand(0.35, 0.5), 0.3);
          this.kick(out, d * 0.55, next?.kind === 'corner' ? 2 : 5);
        };
        if (actor && this.ball.position.y > 1.3 && actor.position.clone().setY(this.ball.position.y).distanceTo(this.ball.position) < 1.3) {
          actor.setPose('header', this.now, 420);
          clear();
        } else this.withBall(actor, d * 0.35, clear);
        break;
      }

      case 'foul':
        this.withBall(target, d * 0.25, () => {
          if (actor && target) this.run(actor, target.position.clone(), d * 0.35);
          this.later(d * 0.35, () => {
            target?.setPose('fallen', this.now, 800);
            this.stopBall();
            this.effect(() => this.sfx.whistle(1));
          });
        });
        break;

      case 'offside':
        if (actor) this.run(actor, this.forward(actor, 0.12), d * 0.5);
        this.later(d * 0.3, () => {
          this.stopBall();
          this.effect(() => this.sfx.whistle(2));
        });
        break;

      case 'shot':
      case 'header':
        if (event.kind === 'header' && actor && this.ball.position.y > 1.3 && actor.position.clone().setY(this.ball.position.y).distanceTo(this.ball.position) < 1.3) {
          actor.setPose('header', this.now, 420);
          this.shoot(event, report, index, actor, d * 0.85);
        } else {
          this.withBall(actor, d * 0.25, () => this.shoot(event, report, index, actor, d * 0.65));
        }
        break;

      case 'save':
        this.save(actor, d, next?.kind === 'corner', A);
        break;

      case 'block':
        actor?.setPose('tackle', this.now, 450);
        this.kick(next?.kind === 'corner'
          ? this.space.toWorld(A, sign() * 0.45, 1.06, 0.3)
          : this.ball.position.clone().add(this.tmp.set(rand(3, 6) * sign(), 0, -2 * this.space.direction(A))).setY(0.3), d * 0.6, 1.5);
        break;

      case 'miss':
        this.effect(() => { this.sfx.roar(1.2, 0.35); this.stadium.cheer(null, 0.35); });
        break;

      case 'goal':
        this.celebrate(A, actor, d);
        break;

      case 'corner':
        this.setPieceCorner(A, actor, d + (next?.durationMs ?? 0) + 600);
        this.deliverSetPiece(actor, next, d);
        break;

      case 'free_kick':
        this.setPieceFreeKick(A, actor, d + (next?.durationMs ?? 0) + 600);
        if (next?.kind === 'header' || next?.kind === 'clearance') this.deliverSetPiece(actor, next, d);
        break;

      case 'penalty':
        this.setPiecePenalty(A, actor, d + (next?.durationMs ?? 0) + 600);
        break;

      case 'dive':
        this.withBall(actor, d * 0.25, () => {
          if (actor) this.run(actor, this.forward(actor, 0.06), d * 0.25);
          this.later(d * 0.3, () => {
            actor?.setPose('fallen', this.now, 900);
            this.stopBall();
            this.effect(() => this.sfx.whistle(1));
          });
        });
        break;

      case 'kickoff':
      case 'whistle':
        this.effect(() => this.sfx.whistle(event.kind === 'whistle' ? 3 : 1));
        break;
    }
  }

  // ── Frame update ───────────────────────────────────────────────────────────

  update(_dt: number, now: number): void {
    this.advance(now);
  }

  /** Integrate to event/contact boundaries in time order, even after a slow or hidden frame. */
  private advance(now: number): void {
    if (this.advancing) return;
    this.advancing = true;
    try {
      // Idle scenes do not need to simulate minutes spent in a background tab.
      if (!this.actionRunning && now - this.now > 250) this.now = now - 50;
      while (true) {
        this.queue.sort((a, b) => a.at - b.at);
        const due = this.queue[0];
        if (due && due.at <= this.now) {
          this.queue.shift();
          due.run();
          continue;
        }
        if (this.now >= now) break;
        const until = Math.min(now, this.now + 1000 / 60, due?.at ?? Infinity);
        const dt = (until - this.now) / 1000;
        this.now = until;
        this.step(dt);
      }
    } finally {
      this.advancing = false;
    }
  }

  private step(dt: number): void {
    const now = this.now;
    if (this.collector && !this.ball.holder && !this.ball.inFlight && this.collector.position.distanceTo(this.ball.position) < 1.3) {
      if (this.ball.giveTo(this.collector)) {
        this.collector = null;
        this.nextBallDecision = Math.max(this.nextBallDecision, now + 700);
      }
    }
    if (!this.actionRunning && this.phase === 'planning' && now > this.nextBallDecision) this.playOnTheBall();

    const possession = this.possession();
    if (possession && this.lastPossession && possession !== this.lastPossession) this.recover(this.lastPossession);
    this.lastPossession = possession;

    this.shapeTargets = this.shape.compute({
      space: this.space,
      players: this.shapePlayers,
      ball: this.ball.destination(this.tmpBall),
      holder: this.ball.holder,
      possession,
      mentality: { home: this.teams.home?.view.mentality ?? 0, away: this.teams.away?.view.mentality ?? 0 },
    });
    for (const actor of this.actors.values()) {
      if (actor === this.collector) actor.moveTo(this.ball.position, now);
      else if (actor === this.pendingReceiver?.actor && !this.ball.inFlight) actor.moveTo(this.ball.position, now);
      else if (now > actor.scriptedUntil) actor.moveTo(this.targetOf(actor), now);
      actor.update(dt, now, this.ball.position);
    }
    this.ball.update(dt, now);
    const pending = this.pendingReceiver;
    if (pending && pending.motionId !== this.ball.motionId) this.pendingReceiver = null;
    else if (pending && !this.ball.inFlight && this.ball.giveTo(pending.actor, pending.control)) {
      this.pendingReceiver = null;
      pending.onControl?.();
    }
    this.camera.update(dt, now, this.ball.position);
  }

  // ── Choreography helpers ───────────────────────────────────────────────────

  private shoot(event: MatchEvent, report: ActionReport, index: number, shooter: PlayerActor | null, durationMs: number): void {
    const A = report.attackingSide;
    const dir = this.space.direction(A);
    const goalLine = (PITCH.length / 2) * dir;
    const keeper = this.keeper(otherSide(A));
    const blockEvent = report.events[index + 1]?.kind === 'block' ? report.events[index + 1] : undefined;
    const blocker = this.actor(blockEvent?.actorId);

    let aim: Vector3;
    switch (event.shotResult) {
      case 'goal':
        aim = new Vector3(sign() * rand(0.7, PITCH.goalWidth / 2 - 0.4), rand(0.35, PITCH.goalHeight - 0.45), goalLine + 0.75 * dir);
        break;
      case 'saved': {
        const contact = new Vector3(MathUtils.clamp((keeper?.position.x ?? 0) + sign() * rand(0.4, 1), -2, 2), 0, goalLine - 0.7 * dir);
        const spot = keeper?.reachablePoint(contact, durationMs) ?? contact;
        if (keeper) keeper.arriveAt(spot, this.now, durationMs, 1600);
        aim = spot.clone().setY(0.95);
        break;
      }
      case 'blocked': {
        const contact = shooter ? shooter.position.clone().lerp(this.space.goalMouth(A), 0.25) : this.ball.position.clone();
        const spot = blocker?.reachablePoint(contact, durationMs) ?? contact;
        if (blocker) blocker.arriveAt(spot, this.now, durationMs, 1300);
        aim = spot.clone().setY(0.8);
        break;
      }
      default:
        aim = Math.random() < 0.5
          ? new Vector3(sign() * rand(3.1, 5), rand(0.3, 1.4), goalLine + 2.5 * dir)
          : new Vector3(sign() * rand(0, 2), rand(2.7, 3.6), goalLine + 2.5 * dir);
    }

    // A header redirects the delivered ball at the head. It never manufactures a second cross.
    this.kick(aim, durationMs, event.kind === 'header' ? 0.15 : 0.25);
    if (event.shotResult === 'goal') this.later(durationMs, () => this.effect(() => this.stadium.netImpact(aim, this.now)));
  }

  /** The wide creator carries it towards the byline and swings it in; the striker attacks the near post. */
  private cross(A: Side, crosser: PlayerActor, striker: PlayerActor, d: number): void {
    const wing = Math.sign(this.space.toTeam(A, crosser.position).nx) || sign();
    const byline = crosser.reachablePoint(this.space.toWorld(A, wing * 0.82, 0.86), d * 0.35);
    crosser.arriveAt(byline, this.now, d * 0.35, d);
    const meet = striker.reachablePoint(this.space.toWorld(A, wing * 0.12, 0.86), d);
    striker.arriveAt(meet, this.now, d, 1100);
    this.trackRunner(A, meet, d);
    this.later(d * 0.35, () => {
      this.kick(meet.clone().setY(2.4), d * 0.65, 2.5, -wing * 0.5);
    });
  }

  /** The creator beats his man to the byline inside the box and pulls it back to an arriving shooter. */
  private cutback(A: Side, creator: PlayerActor, shooter: PlayerActor, d: number): void {
    const wing = Math.sign(this.space.toTeam(A, creator.position).nx) || sign();
    const byline = creator.reachablePoint(this.space.toWorld(A, wing * 0.4, 0.94), d * 0.35);
    creator.arriveAt(byline, this.now, d * 0.35, d);
    const spot = shooter.reachablePoint(this.space.toWorld(A, -wing * 0.05, 0.8), d);
    shooter.arriveAt(spot, this.now, d, d);
    this.later(d * 0.35, () => this.passTo(shooter, spot, d * 0.65));
  }

  /** The nearest defender chases the run, goal-side. */
  private trackRunner(A: Side, spot: Vector3, durationMs: number): void {
    const defender = this.nearest(otherSide(A), spot, ['DEF', 'MID']);
    if (defender) this.run(defender, spot.clone().add(this.tmp.set(rand(-1.2, 1.2), 0, 1.4 * this.space.direction(A))), durationMs);
  }

  private save(keeper: PlayerActor | null, d: number, toCorner: boolean, attacking: Side): void {
    if (!keeper) return;
    const ballAt = this.ball.destination();
    const angle = keeper.group.rotation.y;
    const lateral = (ballAt.x - keeper.position.x) * Math.cos(angle) - (ballAt.z - keeper.position.z) * Math.sin(angle);
    keeper.setPose('dive', this.now, 1100, lateral >= 0 ? 1 : -1);
    keeper.scriptedUntil = this.now + d;
    this.later(d * 0.15, () => {
      if (toCorner) {
        const out = this.space.toWorld(attacking, Math.sign(ballAt.x || 1) * 0.35, 1.07, 0.5);
        this.kick(out, d * 0.5, 2);
      } else {
        if (!this.ball.giveTo(keeper, 'hands')) this.passTo(keeper, keeper.position.clone(), d * 0.35, 0, undefined, 'hands');
      }
      this.effect(() => { this.sfx.roar(1.4, 0.5); this.stadium.cheer(null, 0.45); });
    });
  }

  private celebrate(side: Side, scorer: PlayerActor | null, d: number): void {
    this.effect(() => { this.sfx.roar(3.2, 1); this.stadium.cheer(side, 1); });
    this.later(250, () => this.effect(() => this.sfx.whistle(1)));
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
    this.stopBall();
    const s = sign();
    const flag = this.space.toWorld(A, PITCH.width / 2 / (PITCH.width / 2 - 1) * s, 1.0);
    this.ball.place(flag);
    if (taker) {
      taker.teleport(flag.clone().add(this.tmp.set(0, 0, 0.6 * this.space.direction(A))));
      taker.scriptedUntil = this.now + holdMs;
    }
    this.packTheBox(A, taker, holdMs);
  }

  private setPieceFreeKick(A: Side, taker: PlayerActor | null, holdMs: number): void {
    this.stopBall();
    const nx = rand(-0.35, 0.35);
    const spot = this.space.toWorld(A, nx, 0.72);
    this.ball.place(spot);
    if (taker) {
      taker.teleport(spot.clone().add(this.tmp.set(0, 0, -0.6 * this.space.direction(A))));
      taker.scriptedUntil = this.now + holdMs;
    }
    this.packTheBox(A, taker, holdMs);
    const wall = this.actorsOf(otherSide(A)).filter(a => this.slotOf(a) !== 0).slice(0, 2);
    wall.forEach((actor, i) => this.run(actor, this.space.toWorld(A, nx * 0.7 + (i - 0.5) * 0.06, 0.8), holdMs));
  }

  private setPiecePenalty(A: Side, taker: PlayerActor | null, holdMs: number): void {
    this.stopBall();
    const spotNy = 1 - PITCH.penaltySpot / PITCH.length;
    this.ball.place(this.space.toWorld(A, 0, spotNy));
    for (const actor of this.actors.values()) {
      if (actor === taker) {
        actor.teleport(this.space.toWorld(A, 0, spotNy).add(this.tmp.set(0, 0, -0.6 * this.space.direction(A))));
        actor.scriptedUntil = this.now + holdMs;
      } else if (actor.side !== A && this.slotOf(actor) === 0) {
        actor.teleport(this.space.toWorld(A, 0, 0.995));
        actor.scriptedUntil = this.now + holdMs;
      } else {
        this.run(actor, this.space.toWorld(A, rand(-0.7, 0.7), rand(0.6, 0.66)), holdMs);
      }
    }
  }

  /** Corners and crossed free kicks include the delivery, even when the defender wins it. */
  private deliverSetPiece(taker: PlayerActor | null, next: MatchEvent | undefined, durationMs: number): void {
    const receiver = this.actor(next?.actorId);
    if (!receiver) return;
    const meet = receiver.reachablePoint(receiver.target, durationMs);
    receiver.arriveAt(meet, this.now, durationMs, (next?.durationMs ?? 0) + 300);
    this.later(durationMs * 0.35, () => {
      taker?.setPose('kick', this.now, 280);
      this.kick(meet.clone().setY(2.4), durationMs * 0.65, 3);
    });
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
  private passTo(receiver: PlayerActor, point: Vector3, durationMs: number, height = 0, onControl?: () => void, control: BallControl = 'feet'): void {
    const duration = Math.max(80, durationMs);
    const meet = receiver.reachablePoint(point, duration);
    receiver.arriveAt(meet, this.now, duration, 400);
    this.kick(meet.clone().setY(control === 'hands' ? 0.95 : 0.3), duration, height);
    this.pendingReceiver = { actor: receiver, motionId: this.ball.motionId, control, onControl };
  }

  /** Make any required handover visible before the named player acts. */
  private withBall(actor: PlayerActor | null, durationMs: number, run: () => void): void {
    if (!actor || this.ball.holder === actor || this.ball.giveTo(actor)) {
      run();
      return;
    }
    this.passTo(actor, actor.position.clone(), durationMs, 0, run);
  }

  private kick(point: Vector3, durationMs: number, height = 0, bend = 0): void {
    const holder = this.ball.holder;
    holder?.setPose(holder.isKeeper && this.ball.position.y > 0.6 ? 'throw' : 'kick', this.now, 280);
    this.pendingReceiver = null;
    this.collector = null;
    this.ball.kick(point, this.now, durationMs, height, bend);
    // Split integration at contact before dispatching the next event.
    this.later(Math.max(80, durationMs), () => {});
    this.effect(() => this.sfx.kick(0.6));
  }

  private stopBall(): void {
    this.pendingReceiver = null;
    this.collector = null;
    this.ball.stop();
  }

  private resetChoreography(): void {
    this.queue.length = 0;
    this.pendingReceiver = null;
    this.collector = null;
    if (this.ball.inFlight) this.ball.stop();
    for (const actor of this.actors.values()) {
      actor.scriptedUntil = 0;
      actor.moveTo(actor.position, this.now);
    }
  }

  private effect(run: () => void): void {
    if (!this.seeking) run();
  }

  private dismiss(id: string): void {
    const actor = this.actors.get(id);
    const team = actor ? this.teams[actor.side] : undefined;
    if (team) {
      const wasKeeper = team.slotOf.get(id) === 0;
      team.slotOf.delete(id);
      if (wasKeeper) {
        const emergency = team.view.squad
          .filter(p => team.slotOf.has(p.id))
          .sort((a, b) => b.attributes.goalkeeping - a.attributes.goalkeeping)[0];
        if (emergency) team.slotOf.set(emergency.id, 0);
      }
    }
    this.dismissed.add(id);
    if (this.view) this.sync(this.view, this.now);
  }

  private run(actor: PlayerActor, point: Vector3, durationMs: number): void {
    actor.moveTo(point, this.now, durationMs);
  }

  private later(delayMs: number, run: () => void): void {
    this.queue.push({ at: this.now + delayMs, run });
  }

  /** `side` just lost the ball: everyone caught upfield sprints back into the defensive shape. */
  private recover(side: Side): void {
    for (const actor of this.actorsOf(side)) actor.hurry(this.now + RECOVERY_MS);
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
