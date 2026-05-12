import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

const CONNECT_RETRIES = 30;
const CONNECT_DELAY_MS = 250;

export class CodexAppServer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ws = null;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.pendingServerRequests = new Map();
    this.status = {
      connected: false,
      codexWsUrl: config.codexWsUrl,
      workspace: config.workspace,
      startedProcess: false,
      lastError: null,
    };
  }

  async ensureConnected() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.config.codexAutoStart && !this.proc) {
      this.startProcess();
    }
    await this.connectWithRetry();
    await this.initialize();
  }

  startProcess() {
    this.proc = spawn("codex", ["app-server", "--listen", this.config.codexBindUrl], {
      cwd: this.config.workspace,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.status.startedProcess = true;
    this.proc.stdout.on("data", (chunk) => this.emit("log", chunk.toString()));
    this.proc.stderr.on("data", (chunk) => this.emit("log", chunk.toString()));
    this.proc.once("exit", (code, signal) => {
      this.proc = null;
      this.status.startedProcess = false;
      this.status.connected = false;
      this.emit("status", this.statusSnapshot());
      this.emit("log", `codex app-server exited code=${code} signal=${signal}`);
    });
  }

  async connectWithRetry() {
    let lastError = null;
    for (let attempt = 0; attempt < CONNECT_RETRIES; attempt += 1) {
      try {
        await this.openWebSocket();
        this.status.connected = true;
        this.status.lastError = null;
        this.emit("status", this.statusSnapshot());
        return;
      } catch (error) {
        lastError = error;
        await sleep(CONNECT_DELAY_MS);
      }
    }
    this.status.lastError = lastError?.message || "failed to connect";
    this.emit("status", this.statusSnapshot());
    throw lastError;
  }

  openWebSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.codexWsUrl);
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      ws.once("open", () => {
        settled = true;
        this.ws = ws;
        ws.on("message", (data) => this.handleMessage(data));
        ws.on("close", () => this.handleClose());
        ws.on("error", (error) => this.emit("log", `codex ws error: ${error.message}`));
        resolve();
      });
      ws.once("error", fail);
    });
  }

  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "ai-remote-ctl",
        title: "AI Remote Control",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [],
      },
    });
    this.notify("initialized");
    return result;
  }

  async startThread({ prompt, cwd, model, approvalPolicy, sandbox }) {
    await this.ensureConnected();
    const threadResponse = await this.request("thread/start", compact({
      cwd: cwd || this.config.workspace,
      model,
      approvalPolicy,
      sandbox,
      threadSource: "remote_control",
    }));
    const threadId = threadResponse?.thread?.id;
    if (!threadId) {
      throw new Error("thread/start did not return a thread id");
    }
    const turnResponse = await this.startTurn({ threadId, prompt, cwd, model, approvalPolicy });
    return { thread: threadResponse.thread, turn: turnResponse.turn };
  }

  async startTurn({ threadId, prompt, cwd, model, approvalPolicy }) {
    await this.ensureConnected();
    return this.request("turn/start", compact({
      threadId,
      cwd,
      model,
      approvalPolicy,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: [],
        },
      ],
    }));
  }

  async listThreads({ limit = 20, searchTerm = "" } = {}) {
    await this.ensureConnected();
    return this.request("thread/list", compact({
      limit,
      searchTerm,
    }));
  }

  async interruptTurn(threadId) {
    await this.ensureConnected();
    return this.request("turn/interrupt", { threadId });
  }

  async resolveServerRequest(id, result) {
    await this.ensureConnected();
    this.pendingServerRequests.delete(String(id));
    this.send({ id, result });
  }

  request(method, params) {
    const id = this.nextId++;
    this.send({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 120000);
    });
  }

  notify(method, params) {
    this.send(params === undefined ? { method } : { method, params });
  }

  send(payload) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server is not connected");
    }
    this.ws.send(JSON.stringify(payload));
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.emit("log", `non-json codex message: ${data.toString()}`);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      this.pendingServerRequests.set(String(message.id), message);
      this.emit("serverRequest", message);
      return;
    }

    this.emit("notification", message);
  }

  handleClose() {
    this.status.connected = false;
    this.ws = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex app-server connection closed"));
    }
    this.pending.clear();
    this.emit("status", this.statusSnapshot());
  }

  statusSnapshot() {
    return {
      ...this.status,
      pendingServerRequests: this.pendingServerRequests.size,
    };
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
