const params = new URLSearchParams(location.search);
const token = params.get("token") || localStorage.getItem("airctl_token") || "";
if (token) {
  localStorage.setItem("airctl_token", token);
}

const els = {
  status: document.querySelector("#status"),
  connectBtn: document.querySelector("#connectBtn"),
  sendBtn: document.querySelector("#sendBtn"),
  prompt: document.querySelector("#prompt"),
  threadId: document.querySelector("#threadId"),
  approvalPolicy: document.querySelector("#approvalPolicy"),
  approvalPanel: document.querySelector("#approvalPanel"),
  approvals: document.querySelector("#approvals"),
  conversationList: document.querySelector("#conversationList"),
  events: document.querySelector("#events"),
};

let state = null;
let pendingApprovals = new Map();

connectEvents();
refreshState();

els.connectBtn.addEventListener("click", async () => {
  await post("/api/connect", {});
});

els.sendBtn.addEventListener("click", async () => {
  const prompt = els.prompt.value.trim();
  if (!prompt) return;
  els.sendBtn.disabled = true;
  try {
    const response = await post("/api/send", {
      prompt,
      threadId: els.threadId.value.trim(),
      approvalPolicy: els.approvalPolicy.value,
    });
    const threadId = response.result?.thread?.id || response.result?.turn?.threadId;
    if (threadId) {
      els.threadId.value = threadId;
    }
    els.prompt.value = "";
  } finally {
    els.sendBtn.disabled = false;
  }
});

function connectEvents() {
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/events${qs}`);
  ws.addEventListener("open", () => {
    els.status.textContent = "手机端已连接";
  });
  ws.addEventListener("message", (event) => {
    const packet = JSON.parse(event.data);
    if (packet.type === "snapshot") {
      state = packet.payload;
    } else {
      state = packet.snapshot || state;
      if (packet.type === "serverRequest") {
        pendingApprovals.set(packet.payload.id, packet.payload);
      }
      if (packet.type === "codex" && packet.payload?.method === "serverRequest/resolved") {
        pendingApprovals.delete(String(packet.payload.params?.requestId));
      }
    }
    render();
  });
  ws.addEventListener("close", () => {
    els.status.textContent = "连接断开，重试中";
    setTimeout(connectEvents, 1000);
  });
}

async function refreshState() {
  try {
    state = await get("/api/state");
    render();
  } catch {
    els.status.textContent = "等待服务";
  }
}

function render() {
  if (!state) return;
  const status = state.status || {};
  els.status.textContent = status.connected
    ? `Codex 已连接 · ${status.workspace}`
    : `Codex 未连接 · ${status.lastError || "等待启动"}`;

  renderApprovals();
  renderConversations(state.conversations || []);
  els.events.textContent = (state.events || [])
    .slice(-25)
    .reverse()
    .map((entry) => `${entry.at}\n${JSON.stringify(entry.message, null, 2)}`)
    .join("\n\n");
}

function renderApprovals() {
  const approvals = Array.from(pendingApprovals.values());
  els.approvalPanel.classList.toggle("hidden", approvals.length === 0);
  els.approvals.innerHTML = "";
  for (const approval of approvals) {
    const card = document.createElement("article");
    card.className = "approval";
    const command = approval.params.command || approval.params.reason || approval.method;
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(approval.method)}</strong>
        <pre>${escapeHtml(typeof command === "string" ? command : JSON.stringify(approval.params, null, 2))}</pre>
      </div>
      <div class="approval-actions">
        <button data-decision="decline">拒绝</button>
        <button data-decision="acceptForSession">本会话允许</button>
        <button class="primary" data-decision="accept">允许</button>
      </div>
    `;
    card.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", async () => {
        await post("/api/approval", {
          id: approval.id,
          method: approval.method,
          decision: button.dataset.decision,
        });
        pendingApprovals.delete(approval.id);
        renderApprovals();
      });
    });
    els.approvals.append(card);
  }
}

function renderConversations(conversations) {
  els.conversationList.innerHTML = "";
  if (conversations.length === 0) {
    els.conversationList.innerHTML = `<p class="muted">还没有会话。发送第一条指令后会显示流式输出。</p>`;
    return;
  }
  for (const convo of conversations.slice().reverse()) {
    const section = document.createElement("article");
    section.className = "conversation";
    section.innerHTML = `
      <button class="thread-id" type="button">${escapeHtml(convo.threadId)}</button>
      <div class="messages"></div>
    `;
    section.querySelector(".thread-id").addEventListener("click", () => {
      els.threadId.value = convo.threadId;
    });
    const messages = section.querySelector(".messages");
    for (const message of convo.messages || []) {
      const item = document.createElement("div");
      item.className = `message ${message.role}`;
      item.textContent = message.text;
      messages.append(item);
    }
    els.conversationList.append(section);
  }
}

async function get(url) {
  const response = await fetch(withToken(url));
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function post(url, body) {
  const response = await fetch(withToken(url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "request failed");
  return payload;
}

function withToken(url) {
  if (!token) return url;
  const next = new URL(url, location.href);
  next.searchParams.set("token", token);
  return next.pathname + next.search;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
