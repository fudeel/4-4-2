import { otherSide, type TeamView } from '../../../shared/model/match';
import type { ClientState } from '../../state/GameStore';
import { LineupEditor } from '../components/LineupEditor';
import { h, render, setText } from '../dom';
import type { Screen, ScreenContext } from './Screen';

/** Pre-match room: share the code, pick a formation and lineup, press Ready. */
export class LobbyScreen implements Screen {
  readonly element: HTMLElement;
  private readonly code = h('div', { class: 'room-code' });
  private readonly managers = h('div', { class: 'managers' });
  private readonly readyButton: HTMLButtonElement;
  private readonly status = h('p', { class: 'lobby__status' });
  private readonly editor: LineupEditor;
  private ready = false;

  constructor(private readonly ctx: ScreenContext) {
    this.editor = new LineupEditor({ onChange: lineup => ctx.actions.setLineup(lineup) });
    this.readyButton = h('button', { class: 'btn btn--primary btn--block btn--ready', onClick: () => ctx.actions.setReady(!this.ready) }, 'Ready');
    this.element = h('main', { class: 'lobby' },
      h('header', { class: 'lobby__header' },
        h('button', { class: 'btn btn--ghost btn--small', onClick: () => ctx.actions.leaveRoom() }, '← Leave'),
        h('div', { class: 'lobby__room' }, h('small', null, 'ROOM'), this.code),
        h('button', { class: 'btn btn--ghost btn--small', onClick: () => this.share() }, '🔗 Share'),
      ),
      this.managers,
      h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Your starting six'), this.editor.element),
      h('footer', { class: 'lobby__footer' }, this.status, this.readyButton),
    );
  }

  update(state: ClientState): void {
    const view = state.view;
    if (!view) return;
    const mine = view.teams[view.you];
    const theirs = view.teams[otherSide(view.you)];
    this.ready = mine.ready;

    setText(this.code, view.roomCode);
    render(this.managers, this.managerCard(view.teams.home, view.you === 'home'), h('span', { class: 'vs' }, 'VS'), this.managerCard(view.teams.away, view.you === 'away'));
    this.editor.update({ team: mine, mode: 'prematch', locked: mine.ready, maxSubstitutions: view.rules.maxSubstitutions });

    setText(this.readyButton, mine.ready ? '✓ Ready — tap to change' : 'Ready');
    this.readyButton.classList.toggle('btn--done', mine.ready);
    this.readyButton.disabled = state.connection !== 'online';
    setText(this.status, !theirs.manager
      ? `Waiting for an opponent… share code ${view.roomCode}.`
      : mine.ready
        ? theirs.ready ? 'Kick-off!' : `Waiting for ${theirs.manager.name}…`
        : theirs.ready ? `${theirs.manager.name} is ready. Your move!` : 'Set up your team and press Ready.');
  }

  destroy(): void {
    // Nothing to clean up.
  }

  private managerCard(team: TeamView, isYou: boolean) {
    const manager = team.manager;
    return h('div', { class: `manager ${isYou ? 'manager--you' : ''}`, style: { '--team': team.team.primaryColor } as Record<string, string> },
      h('div', { class: 'manager__crest', style: { background: team.team.primaryColor } }, team.team.shortName),
      h('div', { class: 'manager__info' },
        h('strong', null, team.team.name),
        h('small', null, manager ? `${manager.isBot ? '🤖 ' : ''}${manager.name}${isYou ? ' (you)' : ''}` : 'Waiting…'),
      ),
      h('span', { class: `manager__ready ${team.ready ? 'manager__ready--on' : ''}` }, team.ready ? 'READY' : manager ? '…' : ''),
    );
  }

  private async share(): Promise<void> {
    const view = this.ctx.store.get().view;
    if (!view) return;
    const link = this.ctx.actions.shareLink(view.roomCode);
    const shareData = { title: '4-4-2', text: `Join my 4-4-2 match! Room ${view.roomCode}`, url: link };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(link);
        this.ctx.toaster.show('Invite link copied!', 'success');
      }
    } catch {
      this.ctx.toaster.show(`Room code: ${view.roomCode}`, 'info');
    }
  }
}
