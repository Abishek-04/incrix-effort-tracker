export const DEPTS = ["Content", "Design", "Automation", "Software", "Sales", "Admin", "Common"] as const;
export type Dept = (typeof DEPTS)[number];

export const STATUSES = ["Done", "In Progress", "Blocked"] as const;
export type Status = (typeof STATUSES)[number];

export const UIUX = "UI/UX Design";
export const ENGINEERING = "Engineering";

export type Member = {
  id: string;
  name: string;
  role: string;
  dept: Dept;
  target: number;
  active: boolean;
  order: number;
};

export type Rate = {
  id: string;
  dept: Dept;
  type: string;
  unit: string;
  rate: number;
  /** Sub-group inside a department, e.g. "Engineering" or "UI/UX Design" in Software. Empty for none. */
  group: string;
  /**
   * Roughly how long this work takes when done properly. Used to spot a whole deliverable
   * claimed in a fraction of the time. Absent means no expectation is set.
   */
  typicalHours?: number;
  order: number;
};

export type Entry = {
  id: string;
  date: string; // YYYY-MM-DD
  memberId: string;
  /** Snapshot so the entry stays readable if the member is removed. */
  memberName: string;
  dept: Dept;
  typeId: string;
  /** Snapshot so the entry stays readable if the work type is removed. */
  typeName: string;
  desc: string;
  client: string;
  qty: number;
  hours: number | null;
  /** "HH:MM" — when the work started. Absent on entries logged before this was recorded. */
  startTime?: string;
  /** Set when this entry is a contribution to a shared job card. */
  jobId?: string;
  /** Points stamped by the job split — zero while the card is awaiting confirmation. */
  points?: number;
  /** What the split is worth once the card is confirmed. Only set while it isn't. */
  pendingPoints?: number;
  /** This contributor's fraction of the job, 0–1. Only set alongside jobId. */
  share?: number;
  /** A colleague's entry seen by a team member: the work is visible, the points are not. */
  masked?: true;
  status: Status;
  createdAt: string;
  updatedAt: string;
};

export const JOB_STATUSES = ["Open", "Done"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** One person's logged time on a job card, mirrored onto the card so the split can be recalculated. */
export type Contribution = {
  entryId: string;
  month: string;
  memberId: string;
  memberName: string;
  date: string;
  hours: number;
  share: number;
  points: number;
};

/**
 * A job card is one deliverable — a reel, a poster, a screen. It holds the points once,
 * however many people work on it over however many days, and splits them by time spent.
 */
export type Job = {
  id: string;
  title: string;
  client: string;
  dept: Dept;
  typeId: string;
  /** Snapshot so the card stays readable if the work type is removed. */
  typeName: string;
  qty: number;
  status: JobStatus;
  /** rate × qty at the time of the last recalculation — the pot shared between contributors. */
  points: number;
  /** Until this is true the card's points count for nobody. Small cards confirm themselves. */
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  contributions: Contribution[];
  createdBy: string;
  /** True when the card only exists because someone joined work already logged. */
  fromEntry?: boolean;
  createdAt: string;
  closedAt: string | null;
  updatedAt: string;
};

export type Bootstrap = { team: Member[]; rates: Rate[] };

/** A login account as shown to administrators (never includes the password hash). */
export type AccountInfo = {
  role: "admin" | "team" | "member";
  email: string;
  updatedAt: string;
  /** Set for personal logins: the team member this login signs in as. */
  memberId?: string;
};
