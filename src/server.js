import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { CodexAppServer } from "./codexAppServer.js";
import { localNetworkUrls, readConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const config = readConfig();
const codex = new CodexAppServer(config);
const browserClients = new Set();
const eventLog = [];
const conversations = new Map();

const server = http.createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

const wss = new WebSocketServer({ server, path: "/events" });
wss.on("connection", (ws, req) => {
  if (!isAuthorized(req)) {
    ws.close(1008, "unauthorized");
    return;
  }
  browserClients.add(ws);
  ws.send(JSON.stringify({ type: "snapshot", payload: snapshot() }));
  ws.on("close", () => browserClients.delete(ws));
});

codex.on("status", (status) => publish("status", status));
codex.on("log", (line) => publish("log", { line }));
codex.on("serverRequest", (message) => publish("serverRequest", normalizeServerRequest(message)));
codex.on("notification", (message) => {
  applyNotification(message);
  publish("codex", message);
});

server.listen(config.port, config.host, async () => {
  console.log(`AIRemoteCtl listening on ${config.host}:${config.port}`);
  for (const url of localNetworkUrls(config.port)) {
    console.log(`  ${url}${config.token ? `?token=${encodeURIComponent(config.token)}` : ""}`);
  }
  console.log(`Workspace: ${config.workspace}`);
  console.log(`Codex WS: ${config.codexWsUrl}`);
  codex.ensureConnected().catch((error) => {
    console.warn(`Codex connection deferred: ${error.message}`);
  });
});

async function handleApi(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/state")) {
    sendJson(res, 200, snapshot());
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/connect")) {
    await codex.ensureConnected();
    sendJson(res, 200, { ok: true, status: codex.statusSnapshot() });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/send")) {
    const body = await readJson(req);
    if (!body.prompt?.trim()) {
      sendJson(res, 400, { error: "prompt is required" });
      return;
    }
    const result = body.threadId
      ? await codex.startTurn({
          threadId: body.threadId,
          prompt: body.prompt,
          cwd: body.cwd || config.workspace,
          model: body.model,
          approvalPolicy: body.approvalPolicy || "on-request",
        })
      : await codex.startThread({
          prompt: body.prompt,
          cwd: body.cwd || config.workspace,
          model: body.model,
          approvalPolicy: body.approvalPolicy || "on-request",
          sandbox: body.sandbox || "workspace-write",
        });
    sendJson(res, 200, { ok: true, result });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/approval")) {
    const body = await readJson(req);
    const result = approvalResult(body);
    await codex.resolveServerRequest(body.id, result);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/threads")) {
    const body = await readJson(req);
    const result = await codex.listThreads(body);
    sendJson(res, 200, { ok: true, result });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = path.resolve(publicDir, `.${pathname}`);
  if (!target.startsWith(publicDir)) {
    sendText(res, 403, "forbidden");
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { "content-type": contentType(target) });
    res.end(data);
  } catch {
    sendText(res, 404, "not found");
  }
}

function applyNotification(message) {
  remember(message);
  const { method, params = {} } = message;
  const threadId = params.threadId || params.thread_id;
  if (!threadId) {
    return;
  }
  const convo = conversations.get(threadId) || { threadId, title: threadId, messages: [], busy: false };
  if (method === "thread/started" && params.thread?.id) {
    convo.threadId = params.thread.id;
    convo.title = params.thread.name || params.thread.id;
  }
  if (method === "turn/started") {
    convo.busy = true;
  }
  if (method === "turn/completed") {
    convo.busy = false;
  }
  if (method === "item/agentMessage/delta") {
    appendAssistantDelta(convo, params.itemId || params.item_id || "assistant", params.delta || "");
  }
  if (method === "item/commandExecution/outputDelta" || method === "command/exec/outputDelta") {
    appendToolDelta(convo, params.itemId || params.item_id || "tool", params.delta || "");
  }
  conversations.set(convo.threadId, convo);
}

function appendAssistantDelta(convo, itemId, delta) {
  let msg = convo.messages.find((entry) => entry.id === itemId);
  if (!msg) {
    msg = { id: itemId, role: "assistant", text: "" };
    convo.messages.push(msg);
  }
  msg.text += delta;
}

function appendToolDelta(convo, itemId, delta) {
  let msg = convo.messages.find((entry) => entry.id === itemId);
  if (!msg) {
    msg = { id: itemId, role: "tool", text: "" };
    convo.messages.push(msg);
  }
  msg.text += delta;
}

function normalizeServerRequest(message) {
  remember(message);
  return {
    id: String(message.id),
    method: message.method,
    params: message.params || {},
  };
}

function approvalResult(body) {
  const decision = body.decision === "acceptForSession" ? "acceptForSession" : body.decision === "decline" ? "decline" : "accept";
  if (body.method === "item/permissions/requestApproval") {
    return {
      permissions: body.permissions || { network: null, fileSystem: null },
      scope: body.scope || "turn",
    };
  }
  return { decision };
}

function snapshot() {
  return {
    status: codex.statusSnapshot(),
    conversations: Array.from(conversations.values()),
    events: eventLog.slice(-100),
  };
}

function remember(message) {
  eventLog.push({ at: new Date().toISOString(), message });
  if (eventLog.length > 200) {
    eventLog.splice(0, eventLog.length - 200);
  }
}

function publish(type, payload) {
  const packet = JSON.stringify({ type, payload, snapshot: snapshot() });
  for (const ws of browserClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(packet);
    }
  }
}

function isAuthorized(req) {
  if (!config.token) {
    return true;
  }
  const url = new URL(req.url || "/", "http://localhost");
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return url.searchParams.get("token") === config.token || bearer === config.token;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
