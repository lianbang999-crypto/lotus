import http from "node:http";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// Run against the isolated fixture Worker configured in chat-vite.config.ts.
// This provider emits protocol fixtures, never a genuine model response.
const origin = "http://127.0.0.1:5181";
const runId = randomUUID();
const frames = [];
let providerCalls = 0;
const model = http.createServer(async (req, res) => {
  const body = JSON.parse(await Array.fromAsync(req).then(chunks => Buffer.concat(chunks).toString()));
  providerCalls++;
  const last = body.messages.at(-1);
  res.writeHead(200, {"Content-Type": "text/event-stream"});
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({id: `chatcmpl-${runId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: "lotus-fixture", choices: [{index: 0, delta, finish_reason}]})}\n\n`);
  chunk({role: "assistant"});
  if (last?.role === "user") {
    const title = String(last.content);
    chunk({tool_calls: [{index: 0, id: `tool-${randomUUID()}`, type: "function", function: {name: "saveNote", arguments: JSON.stringify({kind: "note", title, content: "来自本机协议测试夹具", extra: {}})}}]});
    chunk({}, "tool_calls");
  } else {
    chunk({content: "本机协议测试已完成。"});
    chunk({}, "stop");
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve, reject) => { model.once("error", reject); model.listen(5182, "127.0.0.1", resolve); });
const socket = new WebSocket(origin.replace("http:", "ws:") + "/api/agent", {headers: {Origin: origin}});
socket.on("message", (raw) => { try { frames.push(JSON.parse(String(raw))); } catch {} });
const wait = async (predicate, label) => {
  const timeout = Date.now() + 25000;
  while (Date.now() < timeout) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Timed out: ${label}; frames=${JSON.stringify(frames.slice(-8)).slice(0,4000)}`);
};
const entries = async () => (await (await fetch(origin + "/api/entries")).json()).entries;
const history = async () => await (await fetch(origin + "/api/agent/get-messages")).json();
const send = (message) => socket.send(JSON.stringify(message));
async function propose(title) {
  const id = randomUUID();
  send({type: "cf_agent_use_chat_request", id, init: {method: "POST", body: JSON.stringify({messages: [{id: randomUUID(), role: "user", parts: [{type: "text", text: title}]}]})}});
  await wait(() => frames.find(frame => frame.id === id && frame.done), "chat completion");
  const messages = await history();
  const part = messages.flatMap(message => message.parts).find(part => part.type === "tool-saveNote" && part.state === "approval-requested");
  assert.ok(part?.approval?.id, "server should persist native approval-requested tool part");
  assert.equal((await entries()).filter(entry => entry.title === title).length, 0, "pending native proposal must not write entries");
  return part;
}
try {
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const session = await (await fetch(origin + "/api/session")).json();
  assert.equal(session.mode, "local"); assert.equal(session.capabilities.chat, true);
  const approvedTitle = `wire-approved-${runId}`;
  const approved = await propose(approvedTitle);
  send({type: "cf_agent_tool_approval", toolCallId: approved.toolCallId, approved: true, autoContinue: true});
  await wait(async () => (await entries()).find(entry => entry.title === approvedTitle), "approved entry persistence");
  const approvedEntry = (await entries()).find(entry => entry.title === approvedTitle);
  send({type: "cf_agent_tool_approval", toolCallId: approved.toolCallId, approved: true, autoContinue: true});
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal((await entries()).filter(entry => entry.title === approvedTitle).length, 1, "replayed approval must not duplicate records");
  await wait(async () => (await history()).some(m => m.parts.some(p => p.type === "text" && p.text === "本机协议测试已完成。")), "approval continuation response");
  const rejectedTitle = `wire-rejected-${runId}`;
  const rejected = await propose(rejectedTitle);
  send({type: "cf_agent_tool_approval", toolCallId: rejected.toolCallId, approved: false, autoContinue: true});
  await wait(async () => (await history()).some(m => m.parts.some(p => p.toolCallId === rejected.toolCallId && p.state === "output-denied")), "rejection terminal part");
  assert.equal((await entries()).filter(entry => entry.title === rejectedTitle).length, 0, "rejection must not write entries");
  send({type: "cf_agent_tool_approval", toolCallId: `unknown-${runId}`, approved: true, autoContinue: true});
  await wait(() => frames.find(frame => frame.type === "lotus:error"), "unknown approval rejected");
  assert.equal((await entries()).filter(entry => entry.title === rejectedTitle).length, 0);
  console.log(JSON.stringify({ok: true, sdk: "@cloudflare/ai-chat@0.9.3", provider: "local deterministic SSE fixture", providerCalls, approvedEntryId: approvedEntry.id, checks: ["authenticated /api/agent WS handshake", "SDK stream and persisted approval part", "no entry before approval", "native dedicated approval frame", "automatic SDK continuation", "idempotent repeated approval", "rejection without write", "unknown approval rejected"]}, null, 2));
} finally {
  socket.close();
  await new Promise(resolve => model.close(resolve));
}
