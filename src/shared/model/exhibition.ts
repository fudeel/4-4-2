export interface ExhibitionOptions {
  pace: 'quick' | 'classic';
  fairPlay: boolean;
  difficulty: 'casual' | 'balanced' | 'challenging';
}
export const DEFAULT_EXHIBITION: ExhibitionOptions = { pace: 'quick', fairPlay: true, difficulty: 'balanced' };
