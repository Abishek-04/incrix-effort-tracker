import { z } from "zod";
import { DEPTS, STATUSES } from "@/lib/types";

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
  hours: z.number().min(0).max(744).nullable().optional(),
  status: z.enum(STATUSES),
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
};
export const rateCreate = z.object({
  ...rateFields,
  unit: rateFields.unit.optional(),
  group: rateFields.group.optional(),
  id: z.uuid().optional(),
  order: z.number().int().min(0).optional(),
});
export const ratePatch = z.object(rateFields).partial();
export type RateCreate = z.infer<typeof rateCreate>;
export type RatePatch = z.infer<typeof ratePatch>;
