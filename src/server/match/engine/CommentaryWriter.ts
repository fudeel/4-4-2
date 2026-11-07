import { surname } from '../../../shared/model/player';
import type { Rng } from '../../core/Random';
import type { MatchPlayer } from '../model/MatchPlayer';

type Who = MatchPlayer | null | undefined;

const TEMPLATES = {
  buildup: ['{a} picks it up in midfield.', '{a} takes control in the centre.', '{a} looks for an opening.', '{a} drops deep to collect.'],
  pass: ['{a} finds {b} in space.', '{a} threads it to {b}.', 'Neat one-two between {a} and {b}.', '{a} switches play to {b}.'],
  dribble: ['{a} skips past {b}!', '{a} nutmegs {b}!', '{a} drives at {b} and leaves him behind.', 'Lovely turn from {a}, {b} is beaten.'],
  tackle: ['Crunching tackle by {a} on {b}.', '{a} times the challenge perfectly.', '{a} muscles {b} off the ball.'],
  interception: ['{a} reads it and intercepts.', 'Cut out by {a}.', '{a} steps in front and steals it.'],
  longBall: ['{a} launches it long towards {b}!', 'Route one! {a} goes over the top for {b}.'],
  throughBall: ['{a} slides {b} through!', 'Defence-splitting pass from {a} to {b}!', '{a} lifts it over the top, {b} is in!'],
  cross: ['{a} whips in a cross for {b}!', '{a} cuts it back to {b}!'],
  soloRun: ['{a} goes alone and beats {b}!', '{a} dances past {b} into the box!'],
  clearance: ['{a} hacks it clear.', 'Hoofed away by {a}.', '{a} clears the danger.'],
  clearedForCorner: ['{a} turns it behind for a corner.', '{a} blocks the cross, corner kick.'],
  foul: ['{a} brings down {b}.', 'Clumsy from {a}, {b} goes down.', '{a} hauls back {b}.'],
  foulInBox: ['{a} clips {b} in the box... PENALTY!', 'Penalty! {a} wipes out {b}!'],
  offside: ['The flag is up! {a} is offside.', 'Offside trap works to perfection, {a} was caught.'],
  offsideBeaten: ['The trap fails! {a} is clean through on goal!'],
  shot: ['{a} shoots!', '{a} lets fly!', '{a} goes for goal!', '{a} pulls the trigger!'],
  block: ['Blocked by {a}!', '{a} throws his body in the way!'],
  save: ['Great save by {a}!', '{a} tips it round the post!', '{a} gets down well to keep it out.', 'Stopped by {a}!'],
  saveHeld: ['{a} gathers it comfortably.', 'Straight at {a}.'],
  miss: ['{a} drags it wide.', 'Over the bar from {a}.', '{a} should have done better!', 'Just past the post from {a}!'],
  goal: ['GOAL! {a} finds the net!', 'GOAL!!! What a finish from {a}!', 'GOAL! {a} makes no mistake!', 'GOAL! {a} buries it!'],
  goalAssisted: ['GOAL! {a} finishes it off, assist {b}!', 'GOAL!!! {a} converts after great work by {b}!'],
  corner: ['{a} swings in the corner...', '{a} to take the corner.'],
  header: ['{a} rises highest and heads it!', 'Powerful header from {a}!'],
  aerialLost: ['{a} wins it in the air and clears.', '{a} heads it away.'],
  penalty: ['{a} steps up to take the penalty...', '{a} places the ball on the spot...'],
  freeKick: ['{a} lines up the free kick...', 'Free kick in a dangerous area, {a} stands over it.'],
  freeKickDelivered: ['{a} floats the free kick into the box.'],
  dive: ['{a} goes down in the box... the referee points to the spot!'],
  diveBooked: ['{a} goes down too easily, booked for simulation!'],
  counter: ['They break forward quickly, counter-attack on!', 'Turnover in midfield, counter-attack chance!'],
  counterExposed: ['Too many men forward — they break into the space behind!', '{a} wins it and they counter against a stretched defence!'],
} satisfies Record<string, string[]>;

export type CommentaryKey = keyof typeof TEMPLATES;

/** Produces varied, readable commentary lines for match events. */
export class CommentaryWriter {
  constructor(private readonly rng: Rng) {}

  line(key: CommentaryKey, a?: Who, b?: Who): string {
    return this.rng
      .pick(TEMPLATES[key])
      .replace('{a}', a ? surname(a.name) : 'He')
      .replace('{b}', b ? surname(b.name) : 'a teammate');
  }
}
