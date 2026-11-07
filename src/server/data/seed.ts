import type { PlayerProfile, Position, TraitId } from '../../shared/model/player';
import type { TeamProfile } from '../../shared/model/team';

type Stats = [pace: number, shooting: number, passing: number, dribbling: number, defending: number, physical: number, goalkeeping: number, stamina: number];
type SeedRow = [number: number, name: string, position: Position, nationality: string, age: number, stats: Stats, trait: TraitId | null];

function buildSquad(teamId: string, rows: SeedRow[]): PlayerProfile[] {
  return rows.map(([number, name, position, nationality, age, s, trait]) => ({
    id: `${teamId}-${String(number).padStart(2, '0')}`,
    teamId,
    name,
    number,
    position,
    nationality,
    age,
    attributes: {
      pace: s[0], shooting: s[1], passing: s[2], dribbling: s[3],
      defending: s[4], physical: s[5], goalkeeping: s[6], stamina: s[7],
    },
    trait,
  }));
}

/** Redmill United: physical, direct, hard to beat in the air. */
const REDMILL = buildSquad('rmu', [
  //  #  name                   pos    nat    age  PAC SHO PAS DRI DEF PHY GK  STA
  [1, 'Viktor Halloran', 'GK', 'IRL', 31, [45, 20, 58, 30, 35, 74, 82, 70], 'reflexes'],
  [13, 'Pim Oosterbaan', 'GK', 'NED', 22, [50, 18, 62, 35, 30, 66, 71, 72], null],
  [2, 'Dario Montefiore', 'DEF', 'ITA', 29, [64, 38, 66, 55, 82, 80, 12, 76], 'wall'],
  [4, 'Kwabena Mensah', 'DEF', 'GHA', 26, [79, 35, 58, 60, 77, 84, 10, 80], 'aerial'],
  [5, 'Sten Ruusamäe', 'DEF', 'EST', 33, [52, 40, 70, 48, 80, 78, 14, 64], 'leader'],
  [6, 'Iker Albizu', 'MID', 'ESP', 27, [66, 58, 80, 74, 66, 70, 10, 84], 'engine'],
  [8, 'Theo Marchetti', 'MID', 'ITA', 24, [72, 66, 77, 79, 52, 62, 9, 78], 'playmaker'],
  [14, 'Yusuf Demiralp', 'MID', 'TUR', 30, [60, 55, 72, 62, 74, 81, 11, 75], 'hothead'],
  [16, 'Callum Ashdown', 'MID', 'ENG', 19, [75, 60, 68, 71, 55, 58, 8, 82], null],
  [9, 'Lukas Brandvold', 'FWD', 'NOR', 28, [70, 84, 60, 70, 30, 86, 10, 72], 'aerial'],
  [11, 'Ezequiel Farrapo', 'FWD', 'ARG', 23, [86, 75, 64, 82, 28, 60, 8, 74], 'speedster'],
  [7, 'Jonah Whitlock', 'FWD', 'ENG', 32, [63, 80, 70, 72, 34, 72, 9, 62], 'clinical'],
]);

/** Harbor City: quick, technical, loves the ball. */
const HARBOR = buildSquad('hbc', [
  //  #  name                   pos    nat    age  PAC SHO PAS DRI DEF PHY GK  STA
  [1, 'Mateus Vilanova', 'GK', 'POR', 28, [52, 22, 72, 40, 30, 68, 83, 74], null],
  [13, 'Callum Brodie', 'GK', 'SCO', 34, [40, 18, 55, 28, 28, 72, 76, 64], 'reflexes'],
  [3, 'Anders Fjeldstad', 'DEF', 'DEN', 30, [60, 34, 72, 58, 81, 79, 12, 72], 'leader'],
  [4, 'Olumide Bakare', 'DEF', 'NGA', 25, [84, 38, 62, 66, 79, 78, 11, 82], 'speedster'],
  [5, 'Henri Lavaud', 'DEF', 'FRA', 27, [70, 42, 74, 64, 78, 74, 13, 76], null],
  [6, 'Niko Vrbanić', 'MID', 'CRO', 29, [62, 64, 86, 80, 58, 60, 10, 76], 'playmaker'],
  [8, 'Sami Haddadi', 'MID', 'MAR', 24, [78, 62, 76, 83, 54, 58, 9, 80], null],
  [10, 'Elias Morrow', 'MID', 'USA', 26, [70, 74, 79, 77, 48, 62, 10, 74], 'clinical'],
  [15, 'Tadeo Arriaga', 'MID', 'URU', 31, [58, 52, 70, 60, 78, 80, 12, 78], 'hothead'],
  [9, 'Dimitri Kovalenko', 'FWD', 'UKR', 27, [74, 85, 66, 74, 32, 80, 9, 74], 'clinical'],
  [11, 'Ibrahim Sowande', 'FWD', 'SEN', 21, [90, 72, 60, 84, 26, 64, 8, 78], 'speedster'],
  [7, 'Leo Castellanos', 'FWD', 'MEX', 29, [68, 78, 74, 76, 36, 66, 10, 70], 'engine'],
]);

export const SEED_PLAYERS: PlayerProfile[] = [...REDMILL, ...HARBOR];

export const SEED_TEAMS: TeamProfile[] = [
  {
    id: 'rmu',
    name: 'Redmill United',
    shortName: 'RMU',
    primaryColor: '#c8102e',
    secondaryColor: '#f4f4f4',
    goalkeeperColor: '#f2c230',
    playerIds: REDMILL.map(p => p.id),
  },
  {
    id: 'hbc',
    name: 'Harbor City',
    shortName: 'HBC',
    primaryColor: '#1d4ed8',
    secondaryColor: '#e0f2fe',
    goalkeeperColor: '#22c55e',
    playerIds: HARBOR.map(p => p.id),
  },
];
