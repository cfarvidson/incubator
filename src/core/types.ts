/** A Card: a Linear issue eligible for a Night Run. See CONTEXT.md. */
export interface Card {
  identifier: string;
  title: string;
  description: string;
  /** Linear priority: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low */
  priority: number;
  url: string;
}

export interface LinearPort {
  /** The Night Queue per ADR-0002: assigned to me + Todo + label `ready-for-agent`, any team. */
  fetchNightQueue(): Promise<Card[]>;
}

/** Resolves an `owner/name` Repo Line to a local clone path, or null if no clone exists. */
export type ResolveClone = (repo: string) => string | null;

export interface PlanDeps {
  linear: LinearPort;
  resolveClone: ResolveClone;
}

export interface RunnableCard {
  card: Card;
  repo: string;
  clonePath: string;
}

export interface BouncedCard {
  card: Card;
  reason: string;
}

export interface Plan {
  runnable: RunnableCard[];
  bounced: BouncedCard[];
}
