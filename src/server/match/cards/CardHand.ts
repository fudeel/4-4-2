import { CARD_DEFINITIONS, CARD_IDS, RARITY_WEIGHTS, type CardId, type CardInstance } from '../../../shared/model/cards';
import type { Rng } from '../../core/Random';

/** Deals random cards, weighted by rarity. The deck is endless; rarity keeps strong cards scarce. */
export class CardDealer {
  private dealt = 0;

  constructor(
    private readonly rng: Rng,
    private readonly idPrefix: string,
  ) {}

  deal(avoid: readonly CardId[] = []): CardInstance {
    let cardId = this.drawId();
    // Softly avoid duplicates already in hand: one re-roll.
    if (avoid.includes(cardId)) cardId = this.drawId();
    this.dealt += 1;
    return { instanceId: `${this.idPrefix}-${this.dealt}`, cardId };
  }

  private drawId(): CardId {
    return this.rng.weighted(CARD_IDS, id => RARITY_WEIGHTS[CARD_DEFINITIONS[id].rarity]);
  }
}

export class CardHand {
  private readonly cards: CardInstance[] = [];

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.cards.length;
  }

  get isFull(): boolean {
    return this.cards.length >= this.limit;
  }

  list(): readonly CardInstance[] {
    return this.cards;
  }

  find(instanceId: string): CardInstance | undefined {
    return this.cards.find(c => c.instanceId === instanceId);
  }

  add(card: CardInstance): boolean {
    if (this.isFull) return false;
    this.cards.push(card);
    return true;
  }

  remove(instanceId: string): CardInstance | undefined {
    const index = this.cards.findIndex(c => c.instanceId === instanceId);
    return index === -1 ? undefined : this.cards.splice(index, 1)[0];
  }

  /** Draws from the dealer until the hand is full. */
  refill(dealer: CardDealer): void {
    while (!this.isFull) this.add(dealer.deal(this.cards.map(c => c.cardId)));
  }
}
