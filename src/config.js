import os from "node:os";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

export function readConfig() {
  const workspace = process.env.AIRCTL_WORKSPACE || process.cwd();
  return {
    host: process.env.AIRCTL_HOST || "0.0.0.0",
    port: integerEnv("AIRCTL_PORT", 8787),
    token: process.env.AIRCTL_TOKEN || crypto.randomBytes(18).toString("base64url"),
    workspace: path.resolve(workspace),
    codexWsUrl: process.env.CODEX_WS_URL || "ws://127.0.0.1:8390",
    codexAutoStart: process.env.CODEX_AUTO_START !== "0",
    codexBindUrl: process.env.CODEX_BIND_URL || "ws://127.0.0.1:8390",
  };
}

export function localNetworkUrls(port) {
  const urls = [`http://127.0.0.1:${port}`];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const address of iface || []) {
      if (address.family === "IPv4" && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }
  return urls;
}

function integerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
