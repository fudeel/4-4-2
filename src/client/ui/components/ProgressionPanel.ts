import { money } from '../../../shared/model/club';
import { ATTRIBUTE_LABELS, overallRating, type AttributeKey } from '../../../shared/model/player';
import { CORE_SKILLS, expectedAttendance, FACILITIES, FACILITY_NAMES, facilityLevel, facilityQuote, MAX_SQUAD, TRAINABLE, trainingQuote, YOUTH_MATCHES } from '../../../shared/model/progression';
import type { ClientState } from '../../state/GameStore';
import { h, render, setText } from '../dom';
import type { ScreenContext } from '../screens/Screen';

export class ProgressionPanel {
  readonly element: HTMLElement;
  private readonly facilities = h('div', { class: 'upgrade-grid' });
  private readonly players = h('div', { class: 'training-list' });
  private readonly prospects = h('div', { class: 'training-list' });
  private readonly status = h('p', { class: 'muted', role: 'status' });
  private readonly selected = new Map<string, AttributeKey>();
  constructor(private readonly ctx: ScreenContext) {
    this.element = h('section', { class: 'panel home__panel progression' },
      h('div', null, h('p', { class: 'eyebrow' }, 'BUILD YOUR LEGACY'), h('h2', null, 'Make the next step count.')),
      h('p', { class: 'muted' }, 'Exhibitions earn credits, fans and XP. Repeat opponents gradually reduce income; after 12 games in 24 hours, credit rewards are reduced to 25%.'),
      this.status, this.facilities,
      h('details', null, h('summary', null, 'Individual training'), h('p', { class: 'muted' }, 'Young players develop faster. Core skills cost less, upgraded facilities improve gains, and every skill has a potential ceiling.'), this.players),
      h('details', null, h('summary', null, 'Youth academy'), this.prospects),
    );
  }
  update(state: ClientState): void {
    const club = state.club;
    if (!club) return;
    setText(this.status, `Expected home attendance: ${expectedAttendance(club)} · Potential gate income: ${money(expectedAttendance(club) * 10)} credits.`);
    render(this.facilities, ...FACILITIES.map(facility => {
      const q = facilityQuote(club, facility);
      const level = facilityLevel(club, facility);
      return h('article', { class: 'upgrade-card' },
        h('h3', null, `${FACILITY_NAMES[facility]} · ${level ? `Level ${level}` : 'Not built'}`),
        h('p', { class: 'muted' }, `${level < 5 ? 'Next level · ' : ''}${q.benefit}`),
        h('small', { class: q.recommended ? 'recommendation' : 'muted' }, q.recommended ? 'A useful next investment for this club' : facility === 'stadium' ? 'Grow your crowd before buying empty seats.' : 'Build when it fits your development plan.'),
        h('button', { class: 'btn btn--primary', disabled: !q.allowed || state.clubBusy, onClick: () => this.ctx.actions.upgradeFacility(facility) }, level >= 5 ? 'Maximum level' : `${level ? 'Upgrade' : 'Build'} · ${money(q.cost)} credits`),
        !q.allowed ? h('small', { class: 'muted' }, q.reason) : null);
    }));
    render(this.players, ...club.squad.map(player => {
      const attribute = this.selected.get(player.id) ?? CORE_SKILLS[player.position][0]!;
      const q = trainingQuote(club, player.id, attribute);
      const select = h('select', { class: 'input', 'aria-label': `Training skill for ${player.name}`, onChange: () => { this.selected.set(player.id, select.value as AttributeKey); this.update(state); } },
        ...TRAINABLE.map(key => h('option', { value: key, selected: attribute === key }, `${ATTRIBUTE_LABELS[key]} · ${player.attributes[key]}`)));
      return h('article', { class: 'training-card' }, h('h3', null, player.name),
        h('small', { class: 'muted' }, `${player.position} · Age ${player.age} · ${club.development[player.id]!.xp} XP · Skill ceiling ${club.development[player.id]!.potential}`),
        select, h('p', { class: 'muted' }, q.benefit),
        h('button', { class: 'btn btn--ghost', disabled: !q.allowed || state.clubBusy, onClick: () => this.ctx.actions.trainPlayer(player.id, attribute) }, `Train +${q.gain} · ${money(q.cost)} credits · ${q.xpCost} XP`),
        !club.lineup.slots.includes(player.id) ? h('button', { class: 'btn btn--ghost btn--small', disabled: state.clubBusy || club.squad.length <= 12 || (player.position === 'GK' && club.squad.filter(p => p.position === 'GK').length <= 2), onClick: () => this.ctx.actions.releasePlayer(player.id) }, `Release bench player · +${money(Math.round(overallRating(player) * 25))} credits`) : null,
        !q.allowed ? h('small', { class: 'muted' }, q.reason) : null);
    }));
    render(this.prospects,
      h('p', { class: 'muted' }, club.youthLevel ? `Next prospect: ${club.youthProgress}/${YOUTH_MATCHES(club.youthLevel)} exhibitions. Scouting prioritises positions needing depth. Up to three prospects can wait for promotion.` : 'Build your academy to discover young talent by playing exhibitions.'),
      ...club.prospects.map(p => h('article', { class: 'training-card' }, h('h3', null, p.player.name), h('p', { class: 'muted' }, `${p.player.position} · ${p.player.age} years · Potential ${p.potential}`),
        h('button', { class: 'btn btn--primary', disabled: state.clubBusy || club.budget < p.cost || club.squad.length >= MAX_SQUAD, onClick: () => this.ctx.actions.promoteProspect(p.player.id) }, `Promote · ${money(p.cost)} credits`),
        club.squad.length >= MAX_SQUAD ? h('small', { class: 'muted' }, 'Squad full · 18 players') : null)),
    );
  }
}
