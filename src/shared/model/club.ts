import type { Lineup } from './lineup';
import type { PlayerProfile } from './player';
import type { TeamProfile } from './team';

export interface ClubTransaction { id: string; at: number; label: string; amount: number }
export interface PlayerDevelopment { xp: number; potential: number; sessions: number }
export interface ClubMatchResult { id: string; at: number; opponent: string; goalsFor: number; goalsAgainst: number; result: 'W' | 'D' | 'L' }
export interface YouthProspect { player: PlayerProfile; potential: number; cost: number }
export interface ClubTrophy { nightCode: string; name: string; rank: number; at: number }
export interface ClubView {
  id: string;
  ownerId: string;
  team: TeamProfile;
  squad: PlayerProfile[];
  lineup: Lineup;
  budget: number;
  stadium: { name: string; level: number };
  youthLevel: number;
  trainingLevel: number;
  fans: number;
  reputation: number;
  morale: number;
  record: { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number };
  form: ('W' | 'D' | 'L')[];
  development: Record<string, PlayerDevelopment>;
  ledger: ClubTransaction[];
  history: ClubMatchResult[];
  prospects: YouthProspect[];
  youthProgress: number;
  trophies: ClubTrophy[];
  createdAt: number;
}

export const STARTING_BUDGET = 100_000;
export const money = (value: number): string => Math.round(value).toLocaleString('en-GB');
export const stadiumCapacity = (level: number): number => 100 * level * level;
