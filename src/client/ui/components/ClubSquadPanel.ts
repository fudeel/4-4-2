import type { ClubView } from '../../../shared/model/club';
import { LineupBuilder } from '../../../shared/model/lineup';
import type { TeamView } from '../../../shared/model/match';
import type { ClientState } from '../../state/GameStore';
import { h } from '../dom';
import type { ScreenContext } from '../screens/Screen';
import { LineupEditor } from './LineupEditor';

function teamView(club: ClubView): TeamView {
  return { side: 'home', team: club.team, squad: club.squad, lineup: club.lineup, manager: null, ready: false, locked: false, mentality: 0, handCount: 0, subsUsed: 0,
    players: Object.fromEntries(club.squad.map(p => [p.id, { energy: 100, yellowCards: 0, sentOff: false, subbedOff: false, goals: 0, assists: 0, shots: 0, saves: 0, rating: 6 }])),
    stats: { attacks: 0, chancesCreated: 0, shots: 0, shotsOnTarget: 0, xg: 0, fouls: 0, corners: 0, yellowCards: 0, redCards: 0, cardsPlayed: 0 } };
}
export class ClubSquadPanel {
  readonly element: HTMLElement;
  private readonly editor: LineupEditor;
  private readonly auto: HTMLButtonElement;
  constructor(ctx: ScreenContext) {
    this.editor = new LineupEditor({ onChange: lineup => ctx.actions.saveClubLineup(lineup) });
    this.auto = h('button', { class: 'btn btn--ghost btn--block', onClick: () => { const c = ctx.store.get().club; if (c) ctx.actions.saveClubLineup(LineupBuilder.best(c.lineup.formationId, c.squad)); } }, 'Pick my strongest six');
    this.element = h('section', { class: 'squad-tactics scroll-area' }, h('div', { class: 'section-heading' }, h('h2', null, 'THE STARTING VI'), h('small', null, 'Tap two shirts to swap.')),
      this.editor.element, this.auto);
  }
  update(state: ClientState): void {
    if (!state.club) return;
    this.editor.update({ team: teamView(state.club), mode: 'prematch', locked: state.clubBusy, maxSubstitutions: 3 });
    this.auto.disabled = state.clubBusy;
  }
}
