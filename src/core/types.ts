/** A Card: a Linear issue eligible for a Night Run. See CONTEXT.md. */
export interface Card {
  identifier: string;
  title: string;
  /** The Brief: the Card's full body (Linear calls this the description). */
  brief: string;
  /** Linear priority: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low */
  priority: number;
  url: string;
  /** Linear's suggested git branch name for the issue. */
  branchName: string;
}

export interface LinearPort {
  /** The Night Queue per ADR-0002: assigned to me + Todo + label `ready-for-agent`, any team. */
  fetchNightQueue(): Promise<Card[]>;
  /** Claim: move the Card from Todo to In Progress so no other run takes it. */
  claim(card: Card): Promise<void>;
  /** Move the Card to In Review (never Done) with a comment linking its PRs. */
  markInReview(card: Card, prUrls: string[]): Promise<void>;
}

/** Resolves an `owner/name` Repo Line to a local clone path, or null if no clone exists. */
export type ResolveClone = (repo: string) => string | null;

export interface PlanDeps {
  linear: Pick<LinearPort, "fetchNightQueue">;
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

export interface CardOutcome {
  prUrls: string[];
}

export interface CardExecutorPort {
  /** Runs one Card Session in its own worktree of the target repo. */
  execute(runnable: RunnableCard): Promise<CardOutcome>;
}

export interface RanCard {
  card: Card;
  prUrls: string[];
}

export interface MorningReport {
  ran: RanCard[];
  /** Plan-time bounces; the Linear-side Bounce writes arrive with CFA-169. */
  bounced: BouncedCard[];
}

export interface ReportPort {
  write(report: MorningReport): Promise<void>;
}

export interface RunDeps extends PlanDeps {
  linear: LinearPort;
  executor: CardExecutorPort;
  report: ReportPort;
}
