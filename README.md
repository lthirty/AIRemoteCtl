# AIRemoteCtl

手机浏览器控制本机 Codex 的最小可运行原型。实现方式参考 `litter` 的核心思路：电脑端保留 Codex 控制口，手机只连接一个受控 Web 服务。

## 启动

双击：

```text
start-airctl.bat
```

窗口会显示手机访问地址和本次 token。使用期间保持窗口打开。

停止时双击：

```text
stop-airctl.bat
```

也可以手动启动：

```powershell
npm install
$env:AIRCTL_TOKEN="change-me"
npm start
```

服务启动后会打印本机局域网地址。手机和电脑在同一 Wi-Fi 下时，用手机打开：

```text
http://电脑IP:8787?token=change-me
```

默认行为：

- 后端自动启动 `codex app-server --listen ws://127.0.0.1:8390`
- 手机端连接 `AIRemoteCtl`，不会直接暴露 Codex 的 WebSocket
- 发送 prompt 时会新建 Codex thread，也可以填 thread id 继续发送
- 审批请求会显示在手机上，可选择允许、拒绝、本会话允许

## 配置

可通过环境变量覆盖：

```powershell
$env:AIRCTL_HOST="0.0.0.0"
$env:AIRCTL_PORT="8787"
$env:AIRCTL_TOKEN="change-me"
$env:AIRCTL_WORKSPACE="F:\01.AI\17.AIRemoteCtl"
$env:CODEX_WS_URL="ws://127.0.0.1:8390"
$env:CODEX_AUTO_START="1"
$env:CODEX_BIND_URL="ws://127.0.0.1:8390"
```

安全建议：`CODEX_BIND_URL` 保持 `127.0.0.1`。远程访问优先用 Tailscale、ZeroTier、SSH tunnel 或内网，不要把 Codex app-server 直接暴露到公网。

## 后续可扩展

- 二维码配对和一次性 token
- 线程列表、历史恢复、停止 turn
- Tailscale/SSH 自动发现
- 后台推送通知
- 原生 App 包装同一个 HTTP/WebSocket 协议
