import { nightStandings } from '../../../shared/model/night';
import type { ClientState } from '../../state/GameStore';
import { h, render, setText } from '../dom';
import type { Screen, ScreenContext } from './Screen';

export class NightScreen implements Screen {
  readonly element: HTMLElement;
  private readonly body = h('div', { class: 'night-body' });
  private readonly title = h('h1', null, 'One night. All the bragging rights.');
  private readonly error = h('p', { role: 'status', class: 'account-status' });
  private readonly setup: HTMLElement;
  private readonly create: HTMLButtonElement;
  private readonly join: HTMLButtonElement;
  private readonly interval: number;
  constructor(private readonly ctx: ScreenContext) {
    const name = h('input', { class: 'input', 'aria-label': 'Friends night name', maxlength: 36, minlength: 3, required: true, placeholder: 'Friday Night Trophy' });
    const code = h('input', { class: 'input input--code', 'aria-label': 'Night code', maxlength: 5, minlength: 5, required: true, placeholder: 'ABCDE', pattern: '[A-Za-z]{5}' });
    this.create = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Host a friends night');
    this.join = h('button', { class: 'btn btn--ghost', type: 'submit' }, 'Join night');
    this.setup = h('section', { class: 'panel home__panel' },
      h('h2', null, 'Bring the group together'), h('p', { class: 'muted' }, '2–8 managers. Everyone plays everyone once. Quick matches, balanced teams, a shared table and a trophy to take home.'),
      h('form', { class: 'home__panel', onSubmit: (e: SubmitEvent) => { e.preventDefault(); ctx.actions.createNight(name.value); } }, name, this.create),
      h('div', { class: 'divider' }, 'or join your friends'),
      h('form', { class: 'join-row', onSubmit: (e: SubmitEvent) => { e.preventDefault(); ctx.actions.joinNight(code.value); } }, code, this.join));
    this.element = h('main', { class: 'night-screen' },
      h('nav', { class: 'night-nav' }, h('button', { class: 'btn btn--ghost btn--small', onClick: () => ctx.actions.closeNight() }, '← My club'), h('span', { class: 'eyebrow' }, 'FRIENDS NIGHT')),
      h('header', { class: 'night-hero' }, h('p', { class: 'eyebrow' }, 'FOOTBALL. FRIENDS. FRIENDLY RIVALRIES.'), this.title,
        h('p', { class: 'muted' }, 'Bring your club. Settle it on the pitch.')), this.error, this.body, this.setup);
    this.interval = window.setInterval(() => ctx.actions.refreshNight(), 4000);
  }
  update(state: ClientState): void {
    const night = state.night, account = state.account;
    setText(this.error, state.nightBusy ? 'One moment…' : state.nightError);
    this.create.disabled = this.join.disabled = state.nightBusy;
    this.setup.hidden = !!night && night.phase !== 'finished';
    if (!night || !account) { render(this.body); return; }
    setText(this.title, night.name);
    const standings = nightStandings(night);
    const host = night.hostId === account.id;
    const memberName = (id: string) => night.members.find(m => m.ownerId === id)?.clubName ?? 'Club';
    const completed = night.fixtures.filter(f => f.status === 'finished').length;
    const champions = standings.filter(r => r.rank === 1);
    const table = h('div', { class: 'table-scroll' }, h('table', { class: 'night-table' },
      h('caption', null, 'Standings · 3 points for a win, 1 for a draw'),
      h('thead', null, h('tr', null, ...['#', 'Club', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map(s => h('th', { scope: 'col' }, s)))),
      h('tbody', null, ...standings.map(row => h('tr', { class: row.ownerId === account.id ? 'night-table__me' : '' },
        h('td', null, row.rank), h('th', { scope: 'row' }, row.clubName, h('small', null, row.username)), ...[row.played, row.wins, row.draws, row.losses, row.goalsFor - row.goalsAgainst, row.points].map(v => h('td', null, v)))))));
    render(this.body,
      h('section', { class: 'panel night-invite' }, h('div', null, h('p', { class: 'eyebrow' }, night.phase === 'lobby' ? 'INVITE THE GROUP' : `${completed}/${night.fixtures.length} FIXTURES COMPLETE`), h('strong', { class: 'night-code' }, night.code), h('small', { class: 'muted' }, 'Five-letter night code · each friend needs their own account')),
        h('button', { class: 'btn btn--ghost', onClick: () => this.share(night.code) }, 'Copy invitation')),
      night.phase === 'finished' ? h('section', { class: 'night-champion panel' }, h('span', null, '🏆'), h('h2', null, champions.map(c => c.clubName).join(' & ')), h('p', null, champions.length > 1 ? 'Shared champions. Same points, goal difference and goals scored.' : 'Champions of the night!'), h('p', { class: 'muted' }, night.fixtures.some(f => !f.forfeit) ? 'Prizes and podium trophies are waiting in your club.' : 'Walkover-only nights do not award club prizes.')) : null,
      night.phase === 'lobby' ? h('section', { class: 'panel home__panel' }, h('h2', null, `${night.members.length}/8 managers at the table`),
        ...night.members.map(m => h('div', { class: 'night-member' }, h('span', { class: 'club-dot', style: { background: m.color } }), h('strong', null, m.clubName), h('small', { class: 'muted' }, `${m.username}${m.ownerId === night.hostId ? ' · Host' : ''}`))),
        h('p', { class: 'muted' }, 'The host starts when everyone has joined. Squads are locked for the evening; team strength is balanced. Games from the same round can run in parallel.'),
        host ? h('button', { class: 'btn btn--primary', disabled: state.nightBusy || night.members.length < 2, onClick: () => this.ctx.actions.startNight() }, 'Start the night') : h('p', { class: 'muted' }, 'Waiting for the host to start…'),
        h('button', { class: 'btn btn--ghost', disabled: state.nightBusy, onClick: () => this.ctx.actions.leaveNight() }, 'Leave this lobby')) : null,
      night.phase !== 'lobby' ? h('section', { class: 'panel home__panel' }, h('h2', null, 'The table'), table, h('small', { class: 'muted' }, 'Ties: points → goal difference → goals scored. A complete tie shares the place.')) : null,
      ...[...new Set(night.fixtures.map(f => f.round))].map(round => h('section', { class: 'panel home__panel' }, h('h2', null, `Round ${round}`),
        ...night.fixtures.filter(f => f.round === round).map(f => {
          const mine = [f.home, f.away].includes(account.id);
          const blocked = night.fixtures.some(other => other.round < round && other.status !== 'finished');
          return h('article', { class: `fixture ${mine ? 'fixture--mine' : ''}` },
            h('div', { class: 'fixture__teams' }, h('strong', null, memberName(f.home)), h('span', null, f.score ? `${f.score.home} – ${f.score.away}` : 'vs'), h('strong', null, memberName(f.away))),
            h('small', { class: 'muted' }, f.status === 'finished' ? f.forfeit ? 'Walkover · no club income' : 'Full-time' : f.status === 'playing' ? `Match room ${f.roomCode}` : blocked ? 'Finish the previous round first' : mine ? 'Your next match is ready' : 'Waiting for the two managers'),
            mine && f.status !== 'finished' ? h('div', { class: 'fixture__actions' },
              h('button', { class: 'btn btn--primary', disabled: state.nightBusy || blocked || state.connection !== 'online', onClick: () => this.ctx.actions.playFixture(f.id) }, f.status === 'playing' ? 'Join match' : 'Play fixture'),
              h('button', { class: 'btn btn--ghost btn--small', disabled: state.nightBusy, onClick: () => this.ctx.actions.concedeFixture(f.id) }, 'Concede · lose 0–1')) : null);
        }))),
    );
  }
  destroy(): void { window.clearInterval(this.interval); }
  private async share(code: string): Promise<void> {
    const url = new URL(location.href); url.search = ''; url.searchParams.set('night', code);
    try { await navigator.clipboard.writeText(url.toString()); this.ctx.toaster.show('Friends-night invitation copied.', 'success'); }
    catch { this.ctx.toaster.show(`Night code: ${code}`, 'info'); }
  }
}
