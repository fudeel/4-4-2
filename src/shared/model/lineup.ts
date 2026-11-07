import { getFormation, isFormationId, type FormationId, type FormationSlot } from './formation';
import { overallRating, type PlayerProfile } from './player';

export interface Lineup {
  formationId: FormationId;
  /** Player id per formation slot (index-aligned with the formation). `null` = empty slot (red card). */
  slots: (string | null)[];
}

export interface LineupRules {
  squad: readonly PlayerProfile[];
  /** Players who can't take the field (sent off or already substituted). */
  unavailable: ReadonlySet<string>;
  /** How many players must be on the pitch (6 minus red cards). */
  requiredPlayers: number;
  /** Players currently on the pitch. Anyone else entering counts as a substitution. Omit before kick-off. */
  currentlyOnPitch?: ReadonlySet<string>;
  substitutionsLeft?: number;
}

export type LineupCheck =
  | { ok: true; incoming: string[]; outgoing: string[] }
  | { ok: false; error: string };

const fail = (error: string): LineupCheck => ({ ok: false, error });

export class LineupValidator {
  validate(lineup: Lineup, rules: LineupRules): LineupCheck {
    if (!lineup || !isFormationId(lineup.formationId)) return fail('Unknown formation.');
    const formation = getFormation(lineup.formationId);
    if (!Array.isArray(lineup.slots) || lineup.slots.length !== formation.slots.length) {
      return fail('Lineup does not match the formation.');
    }

    const squadIds = new Set(rules.squad.map(p => p.id));
    const selected = new Set<string>();
    for (const id of lineup.slots) {
      if (id === null) continue;
      if (typeof id !== 'string' || !squadIds.has(id)) return fail('Player is not in the squad.');
      if (selected.has(id)) return fail('A player was selected twice.');
      if (rules.unavailable.has(id)) return fail('That player is not available.');
      selected.add(id);
    }
    if (lineup.slots[0] === null) return fail('Someone has to play in goal.');
    if (selected.size !== rules.requiredPlayers) {
      return fail(`Select exactly ${rules.requiredPlayers} players.`);
    }

    if (!rules.currentlyOnPitch) return { ok: true, incoming: [], outgoing: [] };
    const onPitch = rules.currentlyOnPitch;
    const incoming = [...selected].filter(id => !onPitch.has(id));
    const outgoing = [...onPitch].filter(id => !selected.has(id));
    const left = rules.substitutionsLeft ?? 0;
    if (incoming.length > left) {
      return fail(left === 0 ? 'No substitutions left.' : `Only ${left} substitution(s) left.`);
    }
    return { ok: true, incoming, outgoing };
  }
}

/** Assigns `players` to `slots` maximising the sum of role ratings. Empty slots are allowed when there are fewer players. */
function assignOptimally(players: readonly PlayerProfile[], slots: readonly FormationSlot[]): (string | null)[] {
  let best: (string | null)[] = slots.map(() => null);
  let bestScore = -Infinity;
  const current: (string | null)[] = slots.map(() => null);
  const used = new Set<number>();

  const search = (slotIndex: number, placed: number, score: number): void => {
    const remainingSlots = slots.length - slotIndex;
    const remainingPlayers = players.length - placed;
    if (remainingPlayers > remainingSlots) return;
    if (slotIndex === slots.length) {
      if (score > bestScore) {
        bestScore = score;
        best = [...current];
      }
      return;
    }
    const slot = slots[slotIndex]!;
    for (let i = 0; i < players.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      current[slotIndex] = players[i]!.id;
      search(slotIndex + 1, placed + 1, score + overallRating(players[i]!, slot.role));
      used.delete(i);
      current[slotIndex] = null;
    }
    if (remainingSlots > remainingPlayers) {
      // Leave this slot empty, slightly preferring to empty attacking slots.
      search(slotIndex + 1, placed, score - slotIndex * 0.01);
    }
  };

  search(0, 0, 0);
  return best;
}

export class LineupBuilder {
  /** Picks the strongest available lineup for a formation. */
  static best(
    formationId: FormationId,
    squad: readonly PlayerProfile[],
    unavailable: ReadonlySet<string> = new Set(),
    playerCount = 6,
  ): Lineup {
    const formation = getFormation(formationId);
    const available = squad.filter(p => !unavailable.has(p.id));
    const byRating = (role: FormationSlot['role']) =>
      (a: PlayerProfile, b: PlayerProfile) => overallRating(b, role) - overallRating(a, role);

    const keeper = [...available].sort(byRating('GK'))[0];
    if (!keeper) throw new Error('No players available');

    const pool = available.filter(p => p.id !== keeper.id);
    const outfieldSlots = formation.slots.slice(1);
    const picked: PlayerProfile[] = [];
    for (const slot of outfieldSlots) {
      if (picked.length >= playerCount - 1) break;
      const candidate = pool.filter(p => !picked.includes(p)).sort(byRating(slot.role))[0];
      if (candidate) picked.push(candidate);
    }

    return { formationId, slots: [keeper.id, ...assignOptimally(picked, outfieldSlots)] };
  }

  /** Moves the same players into a new formation, keeping the goalkeeper in goal. */
  static changeFormation(lineup: Lineup, formationId: FormationId, squad: readonly PlayerProfile[]): Lineup {
    const formation = getFormation(formationId);
    const byId = new Map(squad.map(p => [p.id, p]));
    const outfield = lineup.slots
      .slice(1)
      .filter((id): id is string => id !== null)
      .map(id => byId.get(id))
      .filter((p): p is PlayerProfile => p !== undefined);
    return { formationId, slots: [lineup.slots[0] ?? null, ...assignOptimally(outfield, formation.slots.slice(1))] };
  }

  static swapSlots(lineup: Lineup, a: number, b: number): Lineup {
    const slots = [...lineup.slots];
    [slots[a], slots[b]] = [slots[b] ?? null, slots[a] ?? null];
    return { ...lineup, slots };
  }

  static placePlayer(lineup: Lineup, slotIndex: number, playerId: string): Lineup {
    const slots = lineup.slots.map(id => (id === playerId ? null : id));
    slots[slotIndex] = playerId;
    return { ...lineup, slots };
  }

  static onPitch(lineup: Lineup): string[] {
    return lineup.slots.filter((id): id is string => id !== null);
  }
}
