import { stadiumCapacity, type ClubView } from './club';
import type { AttributeKey, Position } from './player';

export type Facility = 'stadium' | 'training' | 'youth';
export interface UpgradeQuote { cost: number; gain: number; xpCost: number; allowed: boolean; reason: string; benefit: string; recommended: boolean }
export const FACILITIES: readonly Facility[] = ['stadium', 'training', 'youth'];
export const FACILITY_NAMES: Record<Facility, string> = { stadium: 'Stadium', training: 'Training ground', youth: 'Youth academy' };
export const TRAINABLE: readonly AttributeKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping', 'stamina'];
export const YOUTH_MATCHES = (level: number): number => Math.max(2, 5 - level);
export const MAX_SQUAD = 18;
export const CORE_SKILLS: Record<Position, readonly AttributeKey[]> = {
  GK: ['goalkeeping', 'physical', 'passing'], DEF: ['defending', 'physical', 'pace'], MID: ['passing', 'dribbling', 'stamina'], FWD: ['shooting', 'pace', 'dribbling'],
};
export function facilityLevel(club: ClubView, facility: Facility): number {
  return facility === 'stadium' ? club.stadium.level : facility === 'training' ? club.trainingLevel : club.youthLevel;
}
export function expectedAttendance(club: ClubView): number {
  return Math.min(stadiumCapacity(club.stadium.level), Math.round(club.fans * (0.65 + club.morale / 300)));
}
export function facilityQuote(club: ClubView, facility: Facility): UpgradeQuote {
  const level = facilityLevel(club, facility), next = level + 1;
  const base = { stadium: 18000, training: 14000, youth: 22000 }[facility];
  const cost = Math.round(base * Math.pow(1.7, level) * (1 - Math.min(0.1, club.reputation / 1000)) / 100) * 100;
  let reason = '';
  if (level >= 5) reason = 'Maximum level reached.';
  else if (club.record.played < Math.max(0, next - 2) * 3) reason = `Play ${Math.max(0, next - 2) * 3} exhibitions before this expansion.`;
  else if (facility === 'stadium' && club.fans < stadiumCapacity(level) * 0.65) reason = `Grow to ${Math.ceil(stadiumCapacity(level) * 0.65)} fans before expanding.`;
  else if (club.budget < cost) reason = 'Not enough credits.';
  const benefit = facility === 'stadium'
    ? `${stadiumCapacity(next)} seats. Gate receipts depend on fans, morale and actual attendance.`
    : facility === 'training' ? `+${next * 2} match XP for starters; more efficient individual training.`
      : `A prospect every ${YOUTH_MATCHES(next)} completed exhibitions. Higher levels improve potential and promotion costs.`;
  return { cost, gain: 1, xpCost: 0, allowed: !reason, reason, benefit,
    recommended: facility === 'stadium' ? expectedAttendance(club) >= stadiumCapacity(level) * 0.85 : facility === 'youth' ? level === 0 : club.squad.some(p => club.development[p.id]!.xp >= 30) };
}
export function trainingQuote(club: ClubView, playerId: string, attribute: AttributeKey): UpgradeQuote {
  const player = club.squad.find(p => p.id === playerId);
  const development = club.development[playerId];
  if (!player || !development || !TRAINABLE.includes(attribute)) return { cost: 0, xpCost: 0, gain: 0, allowed: false, reason: 'Choose a player and skill from your squad.', benefit: '', recommended: false };
  const current = player.attributes[attribute];
  const core = CORE_SKILLS[player.position].includes(attribute);
  const cost = Math.round((550 + current * current * 0.5 + development.sessions * 110) * (core ? 1 : 1.25) * (1 - club.trainingLevel * 0.06) / 10) * 10;
  const xpCost = 20 + Math.floor(current / 12) * 3 + development.sessions * 2;
  const gap = development.potential - current;
  const gain = Math.max(0, Math.min(gap, Math.max(1, Math.round(1 + (player.age <= 23 ? 0.7 : 0) + club.trainingLevel * 0.3 - current / 100))));
  const reason = gap <= 0 ? 'This skill has reached the player’s potential.' : development.xp < xpCost ? `Needs ${xpCost} XP · has ${development.xp}. Earn XP in exhibitions.` : club.budget < cost ? 'Not enough credits.' : '';
  return { cost, xpCost, gain: Math.max(0, gain), allowed: !reason, reason, recommended: core && player.age <= 25,
    benefit: `${current} → ${Math.min(development.potential, current + gain)}. Age, potential, role and training facilities determine value.` };
}
