import { describe, expect, it } from "vitest";
import { Chat } from "@ai-sdk/react";
import type { UIMessage, UIMessageChunk } from "ai";

// Exercise the actual AI SDK client parser. Agents' continuation stream begins
// with an existing tool's output, not another tool-input-available chunk.
describe("Agents tool continuation compatibility", () => {
  it.each([true, false])("retains the original pure-tool message when approved=%s", async (approved) => {
    const message: UIMessage = {
      id: "assistant-original",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "tool-saveNote", toolCallId: "note-1", state: "approval-responded", input: { title: "测试笔记" }, approval: { id: "approval-1", approved } },
      ],
    };
    const chunks: UIMessageChunk[] = [
      { type: "start" },
      approved ? { type: "tool-output-available", toolCallId: "note-1", output: { ok: true } } : { type: "tool-output-denied", toolCallId: "note-1" },
      { type: "start-step" },
      { type: "text-start", id: "reply" },
      { type: "text-delta", id: "reply", delta: approved ? "已保存。" : "已取消。" },
      { type: "text-end", id: "reply" },
      { type: "finish-step" },
      { type: "finish" },
    ];
    const chat = new Chat({
      messages: [message],
      transport: {
        sendMessages: async () => { throw new Error("A continuation must not resend a user message"); },
        reconnectToStream: async () => new ReadableStream<UIMessageChunk>({start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); }}),
      },
    });
    await chat.resumeStream();
    expect(chat.error).toBeUndefined();
    expect(chat.status).toBe("ready");
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].id).toBe(message.id);
    expect(chat.messages[0].parts.filter(part => part.type === "tool-saveNote")).toEqual([
      expect.objectContaining({toolCallId: "note-1", input: {title: "测试笔记"}, state: approved ? "output-available" : "output-denied"}),
    ]);
    expect(chat.messages[0].parts.at(-1)).toMatchObject({type: "text", text: approved ? "已保存。" : "已取消。"});
  });
});
