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
  capabilities: { chat: boolean; entries: boolean; write: boolean; dharma: boolean; voice: boolean;
    /** 语音朗读 / 通话回声：中文 TTS（SiliconFlow CosyVoice2）已配置。通话同时需要 voice。 */
    speech: boolean;
    /** 附件上传：ATTACHMENTS R2 桶已绑定。 */
    attachments: boolean;
    /** 模型能看图：按 MODEL_NAME 判断，换成视觉模型后自动为 true，界面据此决定要不要提示"小莲看不到图片内容"。 */
    vision: boolean;
    reminders: "in_app" };
  message?: string;
};
/**
 * 语音条：挂在消息 metadata.voice 上；模型只看到转写文字，音频只用于回放。
 * call: true 表示这条来自实时通话（转写并回聊天线程），没有可回放的音频，只显示「通话」标记。
 */
export type VoiceMeta = { audioId: string | null; durationMs: number; call?: boolean };
export type APIError = { error: string; message: string };
/** POST /api/attachments 的返回：url 是同源相对地址，随消息的 file part 一起持久化。 */
export type AttachmentInfo = { id: string; url: string; mediaType: string; filename: string; size: number };
