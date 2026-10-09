import { z } from "zod";
import { DEPTS, JOB_STATUSES, STATUSES } from "@/lib/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const monthParam = z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");
const id = z.string().min(1).max(100);

export const entryInput = z.object({
  date: isoDate,
  memberId: id,
  typeId: id,
  desc: z.string().trim().min(1, "Description is required").max(300),
  client: z.string().trim().max(120).optional(),
  qty: z.number().positive().max(10000),
  hours: z.number({ error: "Hours spent is required" }).min(0, "Hours spent can't be negative").max(744, "Hours spent is too large"),
  startTime: z.string({ error: "Start time is required" }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time must look like 14:30"),
  status: z.enum(STATUSES),
  /** Set when this entry is time logged against a shared job card. */
  jobId: id.optional(),
});
export const entryCreate = entryInput.extend({ id: z.uuid().optional() });
export const entryUpdate = entryInput.extend({ prevMonth: monthParam });
export type EntryInput = z.infer<typeof entryInput>;
export type EntryCreate = z.infer<typeof entryCreate>;

const memberFields = {
  name: z.string().trim().min(1, "Name can't be empty").max(80),
  role: z.string().trim().max(160),
  dept: z.enum(DEPTS),
  target: z.number().min(0).max(100000),
  active: z.boolean(),
};
export const memberCreate = z.object({
  ...memberFields,
  role: memberFields.role.optional(),
  active: memberFields.active.optional(),
  // id/order let Undo recreate a deleted member so existing entries stay linked
  id: z.uuid().optional(),
  order: z.number().int().min(0).optional(),
});
export const memberPatch = z.object(memberFields).partial();
export type MemberCreate = z.infer<typeof memberCreate>;
export type MemberPatch = z.infer<typeof memberPatch>;

const rateFields = {
  dept: z.enum(DEPTS),
  type: z.string().trim().min(1, "Work type can't be empty").max(120),
  unit: z.string().trim().max(60),
  rate: z.number().min(0).max(10000),
  group: z.string().trim().max(60),
  typicalHours: z.number().min(0).max(200),
};
export const rateCreate = z.object({
  ...rateFields,
  unit: rateFields.unit.optional(),
  group: rateFields.group.optional(),
  typicalHours: rateFields.typicalHours.optional(),
  id: z.uuid().optional(),
  order: z.number().int().min(0).optional(),
});
export const ratePatch = z.object(rateFields).partial();
export type RateCreate = z.infer<typeof rateCreate>;
export type RatePatch = z.infer<typeof ratePatch>;

/* ---------- insights ---------- */
export const periodKind = z.enum(["week", "month"]);
const periodKey = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Expected YYYY-MM or YYYY-MM-DD");
/** A month is "YYYY-MM"; a week is the Monday's date "YYYY-MM-DD". */
const periodFields = { memberId: id, kind: periodKind, period: periodKey };
const matchesKind = (v: { kind: "week" | "month"; period: string }) => (v.kind === "month") === (v.period.length === 7);
const KIND_MESSAGE = "Period doesn't match the week/month selected";

export const insightTarget = z.object(periodFields).refine(matchesKind, KIND_MESSAGE);
export const insightGenerate = z
  .object({ ...periodFields, adminNote: z.string().trim().max(2000, "Keep your recommendations under 2000 characters").optional() })
  .refine(matchesKind, KIND_MESSAGE);
export const insightPublish = z
  .object({ ...periodFields, published: z.boolean(), employeeMessage: z.string().trim().max(4000).optional() })
  .refine(matchesKind, KIND_MESSAGE);
export type InsightTarget = z.infer<typeof insightTarget>;

/* ---------- personal logins ---------- */
export const memberAccountCreate = z.object({
  memberId: id,
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(1, "Enter a password").max(128),
});

/* ---------- job cards ---------- */
const jobFields = {
  title: z.string().trim().min(1, "Give the job card a name").max(120),
  client: z.string().trim().max(120),
  typeId: id,
  qty: z.number().positive().max(10000),
  status: z.enum(JOB_STATUSES),
};
export const jobCreate = z.object({ ...jobFields, client: jobFields.client.optional(), qty: jobFields.qty.optional() }).omit({ status: true });
export const jobPatch = z.object({ ...jobFields, confirmed: z.boolean() }).partial();
export type JobCreate = z.infer<typeof jobCreate>;
export type JobPatch = z.infer<typeof jobPatch>;
