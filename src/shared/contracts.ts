import { z } from "zod";

export const entryKinds = ["note", "diary", "merit", "ledger", "practice", "schedule"] as const;
export const entryKindSchema = z.enum(entryKinds);
export type EntryKind = z.infer<typeof entryKindSchema>;
const shortText = z.string().trim().min(1).max(160);
export const entryInputSchema = z.object({
  kind: entryKindSchema,
  title: shortText,
  content: z.string().max(20000).default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  extra: z.object({
    amountCents: z.number().int().min(0).max(100_000_000_000).optional(),
    direction: z.enum(["income", "expense"]).optional(),
    currency: z.literal("CNY").optional(),
    count: z.number().int().min(0).max(100_000_000).optional(),
    unit: z.string().max(20).optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    completed: z.boolean().optional(),
  }).strict().default({}),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "ledger" && (value.extra.amountCents === undefined || !value.extra.direction)) {
    ctx.addIssue({ code: "custom", message: "账目需要金额（整数分）及收支方向", path: ["extra"] });
  }
  if (value.kind === "schedule" && !value.extra.dueAt) {
    ctx.addIssue({ code: "custom", message: "日程需要包含时区的准确时间", path: ["extra", "dueAt"] });
  }
});
export type EntryInput = z.infer<typeof entryInputSchema>;
export type Entry = EntryInput & { id: string; version: number; createdAt: string; updatedAt: string };
export const proposalInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), entry: entryInputSchema }).strict(),
  z.object({ action: z.literal("update"), entryId: z.string().min(1).max(100), expectedVersion: z.number().int().positive(), entry: entryInputSchema }).strict(),
  z.object({ action: z.literal("delete"), entryId: z.string().min(1).max(100), expectedVersion: z.number().int().positive() }).strict(),
]);
export type ProposalInput = z.infer<typeof proposalInputSchema>;
export type Proposal = { id: string; status: "pending" | "approved" | "rejected"; operation: ProposalInput; createdAt: string; resolvedAt: string | null; result: Entry | { deleted: string } | null };
export type SessionInfo = {
  authenticated: boolean;
  user: { accountId: string; name: string; isAnonymous: boolean } | null;
  mode: "cloud" | "local" | "unconfigured";
  capabilities: { chat: boolean; entries: boolean; write: boolean; dharma: boolean; reminders: "in_app" };
  message?: string;
};
export type APIError = { error: string; message: string };
