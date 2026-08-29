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
  /** Whether the Card's team has a `needs-info` label; without one a Bounce cannot land. */
  teamHasNeedsInfo: boolean;
}

export interface LinearPort {
  /** The Night Queue per ADR-0002: assigned to me + Todo + label `ready-for-agent`, any team. */
  fetchNightQueue(): Promise<Card[]>;
  /** Stranded Cards: Claimed by a Night Run that never finished, still In Progress. */
  fetchStranded(): Promise<Card[]>;
  /** Claim: move the Card from Todo to In Progress so no other run takes it; leaves a Claim comment. */
  claim(card: Card): Promise<void>;
  /** Move the Card to In Review (never Done) with a comment linking its PRs. */
  markInReview(card: Card, prUrls: string[]): Promise<void>;
  /** Bounce: back to Todo, `ready-for-agent` swapped for `needs-info`, explanatory comment. */
  bounce(card: Card, reason: string): Promise<void>;
}

/** Resolves an `owner/name` Repo Line to a local clone path, or null if no clone exists. */
export type ResolveClone = (repo: string) => string | null;

export interface PlanDeps {
  linear: Pick<LinearPort, "fetchNightQueue" | "fetchStranded">;
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
  /** Wall-clock session time; absent for Plan-time Bounces, which never ran. */
  durationMs?: number;
  /** True when the session hit the Duration Cap; the Morning Report says "timed out". */
  timedOut?: boolean;
}

/** A Card excluded at Plan time because its team is not onboarded; it gets no Linear writes at all. */
export interface ExcludedCard {
  card: Card;
  reason: string;
}

export interface Plan {
  runnable: RunnableCard[];
  bounced: BouncedCard[];
  excluded: ExcludedCard[];
}

/** The outcome of one Card Session: PR links, failure, timeout (per CFA-166), or rate limiting (per CFA-175). */
export type CardSessionResult =
  | { kind: "success"; prUrls: string[] }
  | { kind: "failure"; reason: string }
  | { kind: "timeout"; reason: string }
  /** Rate limiting is a value on this seam, never an exception; core retries with Backoff until the Stop Time. */
  | { kind: "rate-limited" };

export interface CardExecutorPort {
  /** Runs one Card Session in its own worktree of the target repo. */
  execute(runnable: RunnableCard): Promise<CardSessionResult>;
}

export interface RanCard {
  card: Card;
  prUrls: string[];
  /** Wall-clock time of the Card Session, including any rate-limit waits. */
  durationMs: number;
}

export interface MorningReport {
  ran: RanCard[];
  /** Every Bounced Card - at Plan time or after a failed/timed-out session. */
  bounced: BouncedCard[];
  /** Cards from teams that are not onboarded; untouched in Linear. */
  excluded: ExcludedCard[];
  /** Runnable Cards never started because the Stop Time was reached; they stay in the Night Queue. */
  notStarted: Card[];
  /** Set when the night crashed mid-queue; the report still lands with the outcomes so far. */
  crashReason?: string;
}

export interface ClockPort {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export interface RunLogPort {
  /** One run-log line; the adapter stamps it with the wall-clock time. */
  log(message: string): void;
}

export interface MorningReportPort {
  /** Idempotent whole-report write; called after every Card outcome so a dead run still leaves a report. */
  write(report: MorningReport): Promise<void>;
}

export interface RunDeps extends PlanDeps {
  linear: LinearPort;
  executor: CardExecutorPort;
  runLog: RunLogPort;
  morningReport: MorningReportPort;
  clock: ClockPort;
  /** The one chance to abort after seeing the Plan: false runs nothing (CFA-170). */
  confirm(plan: Plan): Promise<boolean>;
}

export interface RunOptions {
  /** Stop Time as HH:MM - no new Card starts once the clock passes it. */
  stopTime: string;
  /** Display-only: the Claude Profile name, recorded in the Run Log's start line. */
  claudeProfile?: string;
}
