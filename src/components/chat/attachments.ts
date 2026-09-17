import type { AttachmentInfo } from "../../shared/contracts";

/** 待发送的附件：选中后先留在本地，随下一条消息一起发走。url 是 createObjectURL 的预览地址，用完要 revoke。 */
export type Draft = { id: string; file: File; url: string };

/** 与服务端白名单一致；.md / .docx 另给扩展名，是因为部分浏览器给它们的 MIME 是空的。 */
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.md,.txt,.docx";

const BY_EXT: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
/** 浏览器对 .md / .docx 常给空 MIME 或 application/octet-stream，按扩展名补齐，否则服务端会按类型拒收。 */
export function mediaTypeOf(file: File) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  return BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? file.type;
}

export const readableSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const attachmentLabel = (mediaType: string) =>
  mediaType.startsWith("image/") ? "图片" : mediaType === "application/pdf" ? "PDF" : mediaType.startsWith("text/") ? "文本" : mediaType.includes("wordprocessingml") ? "Word 文档" : "文件";

/** 一次传一个文件，原始字节直接作请求体（和语音条一样）；错误信息沿用服务端口径。 */
export async function uploadAttachment(file: File): Promise<AttachmentInfo> {
  const response = await fetch("/api/attachments", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": mediaTypeOf(file), "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "附件没能上传，请再试一次");
  return data as AttachmentInfo;
}
