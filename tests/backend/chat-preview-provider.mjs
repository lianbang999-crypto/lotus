import http from "node:http";
import { randomUUID } from "node:crypto";

// Deterministic browser QA fixture, never a production model adapter.
const server = http.createServer(async (request, response) => {
  if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
  try {
    const body = JSON.parse(await Array.fromAsync(request).then(chunks => Buffer.concat(chunks).toString()));
    const last = body.messages.at(-1);
    const id = `fixture-${randomUUID()}`;
    const text = typeof last?.content === "string" ? last.content : Array.isArray(last?.content) ? last.content.map(part => part.text || "").join("") : "";
    response.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-store"});
    const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({id, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: "lotus-local-fixture", choices: [{index: 0, delta, finish_reason}]})}\n\n`);
    chunk({role: "assistant"});
    if (last?.role === "user" && /法义|原文|印光|大安|开示/.test(text)) {
      chunk({content: "这是本机界面测试服务，尚未连接真实模型和法义检索，因此不能提供已核验的引文。你可以试着说：帮我记录今天念佛 108 声。"});
      chunk({}, "stop");
      console.log("fixture response: honest retrieval-unavailable text");
    } else if (last?.role === "user") {
      const practice = /功课|念佛|佛号|诵经/.test(text);
      const count = Number(text.match(/(?:念佛|佛号|诵经|记录)?\s*(\d+)\s*(?:声|遍|次)/)?.[1] || 108);
      const entry = practice
        ? {kind: "practice", title: "今日念佛功课（本机测试）", content: text, date: new Date().toLocaleDateString("en-CA", {timeZone: "Asia/Shanghai"}), extra: {count, unit: "声"}}
        : {kind: "note", title: "随心笔记（本机测试）", content: text, extra: {}};
      // Deliberately tool-only: real providers need not emit text before approval.
      chunk({tool_calls: [{index: 0, id: `tool-${randomUUID()}`, type: "function", function: {name: practice ? "recordPractice" : "saveNote", arguments: JSON.stringify(entry)}}]});
      chunk({}, "tool_calls");
      console.log(`fixture response: ${practice ? "recordPractice" : "saveNote"} approval`);
    } else {
      const denied = /denied|not approved|rejected|未批准|拒绝/i.test(text);
      chunk({content: denied ? "已取消，没有保存这条记录。你可以继续调整，也可以先放一放。" : "记录已经保存。需要时，可以从我的空间再查看。"});
      chunk({}, "stop");
      console.log(`fixture response: ${denied ? "denied" : "completed"} continuation`);
    }
    response.end("data: [DONE]\n\n");
  } catch {
    if (!response.headersSent) response.writeHead(400, {"Content-Type": "application/json"});
    response.end(JSON.stringify({error: {message: "Invalid local fixture request"}}));
  }
});
server.listen(5182, "127.0.0.1", () => console.log("Lotus local-only UI fixture provider: http://127.0.0.1:5182/v1 (not a real AI model)"));
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
