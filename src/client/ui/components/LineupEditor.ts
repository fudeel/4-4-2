import { FORMATION_IDS, FORMATIONS, getFormation, type FormationId } from '../../../shared/model/formation';
import { LineupBuilder, type Lineup } from '../../../shared/model/lineup';
import type { TeamView } from '../../../shared/model/match';
import { ATTRIBUTE_LABELS, TRAITS, type AttributeKey, type PlayerProfile } from '../../../shared/model/player';
import { h, render } from '../dom';
import { energyColor, ovr, shortName } from '../format';

export interface LineupEditorOptions {
  onChange(lineup: Lineup): void;
}

export interface LineupEditorState {
  team: TeamView;
  /** Pre-match changes are free; at half-time new players count as substitutions. */
  mode: 'prematch' | 'halftime';
  locked: boolean;
  maxSubstitutions: number;
}

const ATTRIBUTE_ORDER: AttributeKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping', 'stamina'];

/**
 * Tap a slot then another slot to swap them, or tap a slot then a bench player
 * (in either order) to bring them on. The server validates every change.
 */
export class LineupEditor {
  readonly element = h('div', { class: 'lineup' });
  private selectedSlot: number | null = null;
  private selectedBench: string | null = null;
  private focusedPlayer: string | null = null;
  private state: LineupEditorState | null = null;

  constructor(private readonly options: LineupEditorOptions) {}

  update(state: LineupEditorState): void {
    this.state = state;
    if (state.locked) {
      this.selectedSlot = null;
      this.selectedBench = null;
    }
    this.draw();
  }

  private draw(): void {
    const state = this.state;
    if (!state) return;
    const { team, locked } = state;
    const lineup = team.lineup;
    const formation = getFormation(lineup.formationId);
    const byId = new Map(team.squad.map(p => [p.id, p]));
    const onPitch = new Set(LineupBuilder.onPitch(lineup));
    const color = team.team.primaryColor;

    const formations = h('div', { class: 'formations', role: 'radiogroup', 'aria-label': 'Formation' },
      FORMATION_IDS.map(id => h('button', {
        class: `chip ${id === lineup.formationId ? 'chip--active' : ''}`,
        disabled: locked,
        title: FORMATIONS[id].description,
        onClick: () => this.changeFormation(id),
      }, h('strong', null, id), h('small', null, FORMATIONS[id].style))),
    );

    const pitch = h('div', { class: 'mini-pitch' },
      h('div', { class: 'mini-pitch__box' }),
      h('div', { class: 'mini-pitch__half' }),
      formation.slots.map((slot, index) => {
        const id = lineup.slots[index] ?? null;
        const player = id ? byId.get(id) : undefined;
        const state = id ? team.players[id] : undefined;
        const fit = player ? ovr(player, slot.role) : 0;
        const natural = player ? ovr(player) : 0;
        return h('button', {
          class: `slot ${this.selectedSlot === index ? 'slot--selected' : ''} ${player ? '' : 'slot--empty'}`,
          style: { left: `${50 + slot.x * 40}%`, bottom: `${12 + slot.y * 105}%` },
          disabled: locked,
          onClick: () => this.clickSlot(index, id),
        },
          h('span', { class: 'slot__shirt', style: { background: index === 0 ? team.team.goalkeeperColor : color } }, player ? String(player.number) : '–'),
          h('span', { class: 'slot__name' }, player ? shortName(player) : 'Empty'),
          h('span', { class: `slot__meta ${player && fit < natural ? 'slot__meta--off' : ''}` }, `${slot.role} ${player ? fit : ''}`),
          state && state.energy < 100 ? h('span', { class: 'slot__energy' }, h('i', { style: { width: `${state.energy}%`, background: energyColor(state.energy) } })) : null,
          state && state.yellowCards > 0 ? h('span', { class: 'slot__booking' }) : null,
        );
      }),
    );

    const bench = team.squad.filter(p => !onPitch.has(p.id));
    const benchList = h('div', { class: 'bench' },
      h('div', { class: 'bench__title' }, 'Bench', state.mode === 'halftime'
        ? h('span', { class: 'bench__subs' }, `Subs ${team.subsUsed}/${state.maxSubstitutions}`)
        : null),
      bench.map(player => {
        const ps = team.players[player.id];
        const unavailable = !!ps && (ps.sentOff || ps.subbedOff);
        return h('button', {
          class: `bench-row ${this.selectedBench === player.id ? 'bench-row--selected' : ''}`,
          disabled: locked || unavailable,
          onClick: () => this.clickBench(player.id),
        },
          h('span', { class: `pos pos--${player.position}` }, player.position),
          h('span', { class: 'bench-row__num' }, String(player.number)),
          h('span', { class: 'bench-row__name' }, player.name, player.trait ? h('em', { title: TRAITS[player.trait].name }, ` ${TRAITS[player.trait].icon}`) : null),
          unavailable
            ? h('span', { class: 'bench-row__tag' }, ps?.sentOff ? '🟥 Sent off' : 'Subbed off')
            : h('span', { class: 'bench-row__ovr' }, String(ovr(player))),
          ps && ps.energy < 100 && !unavailable ? h('span', { class: 'bench-row__energy', style: { color: energyColor(ps.energy) } }, `${ps.energy}%`) : null,
        );
      }),
    );

    const focused = this.focusedPlayer ? byId.get(this.focusedPlayer) : undefined;
    render(this.element,
      formations,
      h('p', { class: 'lineup__hint' }, locked ? 'Locked in. Unready to make changes.' : FORMATIONS[lineup.formationId].description + ' Tap two players to swap them.'),
      pitch,
      focused ? this.playerCard(focused, team) : null,
      benchList,
    );
  }

  private playerCard(player: PlayerProfile, team: TeamView) {
    const state = team.players[player.id];
    const trait = player.trait ? TRAITS[player.trait] : null;
    return h('div', { class: 'player-card' },
      h('div', { class: 'player-card__head' },
        h('span', { class: 'slot__shirt', style: { background: player.position === 'GK' ? team.team.goalkeeperColor : team.team.primaryColor } }, String(player.number)),
        h('div', null,
          h('strong', null, player.name),
          h('small', null, `${player.position} · ${player.nationality} · ${player.age}y · OVR ${ovr(player)}${state ? ` · ⚡${state.energy}%` : ''}`),
        ),
      ),
      h('div', { class: 'attrs' },
        ATTRIBUTE_ORDER.map(key => {
          const value = player.attributes[key];
          return h('div', { class: 'attr' },
            h('span', null, ATTRIBUTE_LABELS[key]),
            h('i', null, h('b', { style: { width: `${value}%`, background: value >= 80 ? 'var(--good)' : value >= 60 ? 'var(--accent)' : 'var(--muted)' } })),
            h('em', null, String(value)),
          );
        }),
      ),
      trait ? h('p', { class: 'player-card__trait' }, `${trait.icon} ${trait.name}: ${trait.description}`) : null,
    );
  }

  private changeFormation(id: FormationId): void {
    const state = this.state;
    if (!state || state.locked || id === state.team.lineup.formationId) return;
    this.selectedSlot = null;
    this.options.onChange(LineupBuilder.changeFormation(state.team.lineup, id, state.team.squad));
  }

  private clickSlot(index: number, playerId: string | null): void {
    const state = this.state;
    if (!state) return;
    if (playerId) this.focusedPlayer = playerId;
    const lineup = state.team.lineup;
    if (this.selectedBench) {
      const incoming = this.selectedBench;
      this.selectedBench = null;
      this.options.onChange(LineupBuilder.placePlayer(lineup, index, incoming));
    } else if (this.selectedSlot === null) {
      this.selectedSlot = index;
    } else if (this.selectedSlot === index) {
      this.selectedSlot = null;
    } else {
      const from = this.selectedSlot;
      this.selectedSlot = null;
      this.options.onChange(LineupBuilder.swapSlots(lineup, from, index));
    }
    this.draw();
  }

  private clickBench(playerId: string): void {
    const state = this.state;
    if (!state) return;
    this.focusedPlayer = playerId;
    if (this.selectedSlot !== null) {
      const slot = this.selectedSlot;
      this.selectedSlot = null;
      this.options.onChange(LineupBuilder.placePlayer(state.team.lineup, slot, playerId));
    } else {
      this.selectedBench = this.selectedBench === playerId ? null : playerId;
    }
    this.draw();
  }
}
