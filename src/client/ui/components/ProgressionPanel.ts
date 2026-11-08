import { money } from '../../../shared/model/club';
import { ATTRIBUTE_LABELS, overallRating, type AttributeKey } from '../../../shared/model/player';
import { CORE_SKILLS, expectedAttendance, FACILITIES, FACILITY_NAMES, facilityLevel, facilityQuote, MAX_SQUAD, TRAINABLE, trainingQuote, YOUTH_MATCHES } from '../../../shared/model/progression';
import type { ClientState } from '../../state/GameStore';
import { h, render, setText } from '../dom';
import { ART, artImage, kitPortrait } from '../football';
import type { ScreenContext } from '../screens/Screen';

type DevelopmentTab = 'facilities' | 'training' | 'academy';
export class ProgressionPanel {
  readonly element: HTMLElement;
  private readonly facilities = h('div', { class: 'facility-grid' });
  private readonly players = h('div', { class: 'training-list scroll-area', hidden: true });
  private readonly prospects = h('div', { class: 'academy-room scroll-area', hidden: true });
  private readonly status = h('p', { class: 'development-status', role: 'status' });
  private readonly selected = new Map<string, AttributeKey>();
  private readonly buttons = new Map<DevelopmentTab, HTMLButtonElement>();
  constructor(private readonly ctx: ScreenContext) {
    const nav = h('nav', { class: 'section-tabs', 'aria-label': 'Club development' });
    for (const [id, label] of [['facilities', 'Facilities'], ['training', 'Player training'], ['academy', 'Youth academy']] as const) {
      const button = h('button', { 'aria-pressed': String(id === 'facilities'), onClick: () => this.show(id) }, label);
      this.buttons.set(id, button); nav.append(button);
    }
    this.element = h('section', { class: 'development-room' },
      h('div', { class: 'section-heading' }, h('h1', null, 'THE NEXT LEVEL'), nav), this.status,
      this.facilities, this.players, this.prospects,
      h('p', { class: 'development-note' }, 'Play to progress. Repeat opponents gradually reduce rewards. After 12 games in 24 hours, credit rewards fall to 25%.'));
  }
  update(state: ClientState): void {
    const club = state.club;
    if (!club) return;
    setText(this.status, `${money(club.budget)} CREDITS · ${expectedAttendance(club)} EXPECTED HOME FANS · ${money(expectedAttendance(club) * 10)} POTENTIAL GATE INCOME`);
    render(this.facilities, ...FACILITIES.map((facility, index) => {
      const q = facilityQuote(club, facility), level = facilityLevel(club, facility);
      return h('article', { class: `facility-card facility-card--${facility}` },
        h('div', { class: 'facility-card__art' }, artImage([ART.stadium, ART.match, ART.night][index]!), h('span', { class: 'facility-card__level' }, level ? `LEVEL ${level}` : 'NEW CHAPTER'), h('h2', null, FACILITY_NAMES[facility])),
        h('div', { class: 'facility-card__body' },
          h('div', { class: 'level-meter', 'aria-label': `Level ${level} of 5` }, ...Array.from({ length: 5 }, (_, i) => h('i', { class: i < level ? 'is-filled' : '' }))),
          h('p', null, `${level < 5 ? 'Next level · ' : ''}${q.benefit}`),
          h('small', { class: q.recommended ? 'recommendation' : 'muted' }, q.recommended ? 'RECOMMENDED FOR YOUR CLUB' : facility === 'stadium' ? 'Fill your ground before adding seats.' : 'Your next step. Your call.'),
          h('button', { class: 'btn btn--primary', disabled: !q.allowed || state.clubBusy, onClick: () => this.ctx.actions.upgradeFacility(facility) }, level >= 5 ? 'Maximum level' : `${level ? 'Upgrade' : 'Build'} · ${money(q.cost)}`),
          !q.allowed ? h('small', { class: 'upgrade-reason' }, q.reason) : null));
    }));
    render(this.players, ...club.squad.map(player => {
      const attribute = this.selected.get(player.id) ?? CORE_SKILLS[player.position][0]!, q = trainingQuote(club, player.id, attribute);
      const select = h('select', { class: 'input', 'aria-label': `Training skill for ${player.name}`, onChange: () => { this.selected.set(player.id, select.value as AttributeKey); this.update(state); } },
        ...TRAINABLE.map(key => h('option', { value: key, selected: attribute === key }, `${ATTRIBUTE_LABELS[key]} · ${player.attributes[key]}`)));
      return h('article', { class: 'training-card' },
        h('div', { class: 'training-card__head' }, h('div', { class: 'training-card__shirt' }, kitPortrait(player.number, player.position === 'GK' ? club.team.goalkeeperColor : club.team.primaryColor)),
          h('div', null, h('span', { class: 'training-ovr' }, Math.round(overallRating(player))), h('small', null, `${player.position} · AGE ${player.age}`), h('h3', null, player.name))),
        h('div', { class: 'training-card__xp' }, h('span', null, `${club.development[player.id]!.xp} XP`), h('span', null, `${club.development[player.id]!.potential} SKILL CEILING`)),
        select, h('p', { class: 'muted' }, q.benefit),
        h('button', { class: 'btn btn--primary', disabled: !q.allowed || state.clubBusy, onClick: () => this.ctx.actions.trainPlayer(player.id, attribute) }, `+${q.gain} UPGRADE · ${money(q.cost)} CR · ${q.xpCost} XP`),
        !q.allowed ? h('small', { class: 'upgrade-reason' }, q.reason) : null,
        !club.lineup.slots.includes(player.id) ? h('button', { class: 'btn btn--ghost btn--small', disabled: state.clubBusy || club.squad.length <= 12 || (player.position === 'GK' && club.squad.filter(p => p.position === 'GK').length <= 2), onClick: () => this.ctx.actions.releasePlayer(player.id) }, `Release bench player · +${money(Math.round(overallRating(player) * 25))}`) : null);
    }));
    render(this.prospects,
      h('article', { class: 'academy-feature' }, artImage(ART.night), h('div', null, h('p', { class: 'eyebrow' }, 'TOMORROW STARTS HERE'), h('h2', null, 'THE NEXT\nGENERATION.'),
        h('p', null, club.youthLevel ? `Your next prospect: ${club.youthProgress}/${YOUTH_MATCHES(club.youthLevel)} completed exhibitions.` : 'Build your academy. Give local talent a way to the first team.'),
        club.youthLevel ? h('progress', { value: club.youthProgress, max: YOUTH_MATCHES(club.youthLevel), 'aria-label': 'Progress to next youth prospect' }) : h('button', { class: 'btn btn--primary', onClick: () => this.show('facilities') }, 'Build the academy →'),
        h('small', null, 'Scouting targets positions needing depth. Up to three prospects can await promotion.'))),
      ...club.prospects.map(p => h('article', { class: 'prospect-card training-card' }, kitPortrait(0, club.team.primaryColor), h('small', { class: 'eyebrow' }, 'ONE FOR THE FUTURE'), h('h3', null, p.player.name), h('p', { class: 'muted' }, `${p.player.position} · AGE ${p.player.age} · POTENTIAL ${p.potential}`),
        h('button', { class: 'btn btn--primary', disabled: state.clubBusy || club.budget < p.cost || club.squad.length >= MAX_SQUAD, onClick: () => this.ctx.actions.promoteProspect(p.player.id) }, `Promote · ${money(p.cost)}`),
        club.squad.length >= MAX_SQUAD ? h('small', { class: 'muted' }, 'Squad full · 18 players') : null)));
  }
  private show(tab: DevelopmentTab): void {
    this.facilities.hidden = tab !== 'facilities'; this.players.hidden = tab !== 'training'; this.prospects.hidden = tab !== 'academy';
    for (const [id, button] of this.buttons) button.setAttribute('aria-pressed', String(id === tab));
  }
}
