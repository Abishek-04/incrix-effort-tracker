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
  status: Status;
  createdAt: string;
  updatedAt: string;
};

export type Bootstrap = { team: Member[]; rates: Rate[] };

/** A login account as shown to administrators (never includes the password hash). */
export type AccountInfo = { role: "admin" | "team"; email: string; updatedAt: string };
