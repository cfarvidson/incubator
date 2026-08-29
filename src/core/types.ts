/** A Card: a tracker issue eligible for a Night Run. See CONTEXT.md. */
export interface Card {
  identifier: string;
  title: string;
  /** The Brief: the Card's full body (the issue description). */
  brief: string;
  /** Urgency: 0 = none (sorts last), 1 = urgent, 2 = high, 3 = medium, 4 = low. */
  priority: number;
  url: string;
  /** The git branch name for the Card's work; the tracker adapter supplies or generates it. */
  branchName: string;
  /** Whether a Bounce can land where this Card lives (a `needs-info` label exists on its Linear team / GitHub repo). */
  canBounce: boolean;
  /** The repo the Card itself lives in, when the tracker knows it (GitHub); a Brief without a Repo Line targets it. */
  homeRepo?: string;
}

/** One issue tracker serving Cards (per ADR-0003 the active Tracker Profile picks which). */
export interface TrackerPort {
  /** Fails on dead credentials; called once at startup so a broken token is found at 18:00, not at 03:00. */
  checkAuth(): Promise<void>;
  /** The Night Queue per ADR-0003: open, assigned to me, labelled `ready-for-agent`, not yet Claimed. */
  fetchNightQueue(): Promise<Card[]>;
  /** Stranded Cards: Claimed by a Night Run that never finished, still marked in progress. */
  fetchStranded(): Promise<Card[]>;
  /** Claim: mark the Card in progress so no other run takes it; leaves a Claim comment. */
  claim(card: Card): Promise<void>;
  /** Mark the Card in review (never done) with a comment linking its PRs; it leaves the Night Queue. */
  markInReview(card: Card, prUrls: string[]): Promise<void>;
  /** Bounce: back to the groomable state, `ready-for-agent` swapped for `needs-info`, explanatory comment. */
  bounce(card: Card, reason: string): Promise<void>;
}

/** Resolves an `owner/name` Repo Line to a local clone path, or null if no clone exists. */
export type ResolveClone = (repo: string) => string | null;

export interface PlanDeps {
  tracker: Pick<TrackerPort, "fetchNightQueue" | "fetchStranded">;
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

/** A Card excluded at Plan time because it is not onboarded; it gets no tracker writes at all. */
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
  /** Ctrl+C during the session, as a value: core Bounces the Card, the Morning Report lands, cli.ts exits 130. */
  | { kind: "interrupted" }
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
  /** Cards from teams/repos that are not onboarded; untouched in the tracker. */
  excluded: ExcludedCard[];
  /** Runnable Cards never started because the Stop Time was reached; they stay in the Night Queue. */
  notStarted: Card[];
  /** Set when the night crashed mid-queue; the report still lands with the outcomes so far. */
  crashReason?: string;
  /** Set when Ctrl+C stopped the night mid-session; cli.ts exits 130 after the report lands. */
  interrupted?: boolean;
}

export interface ClockPort {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

/**
 * Ctrl+C as a value for the windows outside a Card Session (planning, tracker
 * writes, Backoff sleeps); the supervisor covers Ctrl+C mid-session. The run
 * winds down at the next safe point instead of dying report-less.
 */
export interface InterruptionPort {
  /** True once the user pressed Ctrl+C. */
  interrupted(): boolean;
  /** Resolves on the first Ctrl+C; raced against a Backoff sleep so the wind-down never sits out the timer. */
  whenInterrupted(): Promise<void>;
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
  tracker: TrackerPort;
  executor: CardExecutorPort;
  runLog: RunLogPort;
  morningReport: MorningReportPort;
  clock: ClockPort;
  interruption: InterruptionPort;
  /** The one chance to abort after seeing the Plan: false runs nothing (CFA-170). */
  confirm(plan: Plan): Promise<boolean>;
}

export interface RunOptions {
  /** Stop Time as HH:MM - no new Card starts once the clock passes it. */
  stopTime: string;
  /** Display-only: the Claude Profile name, recorded in the Run Log's start line. */
  claudeProfile?: string;
}
