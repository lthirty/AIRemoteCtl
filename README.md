# AIRemoteCtl

手机浏览器控制本机 Codex 的最小可运行原型。实现方式参考 `litter` 的核心思路：电脑端保留 Codex 控制口，手机只连接一个受控 Web 服务。

## 启动

双击：

```text
start-airctl.bat
```

第一次运行时，如果 Windows OpenSSH Server 还没启用，脚本会自动弹出管理员窗口完成 SSH 初始化。以后再双击同一个 `start-airctl.bat` 即可。

窗口会显示手机浏览器控制台地址和本次 token。使用期间保持窗口打开。

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

## 用 Android Litter 连接

Litter 推荐走 SSH。手机不用打开 `8787` 网页，`8787` 是本项目自带的浏览器控制台。

1. 电脑上双击 `start-airctl.bat`。如果弹出 UAC 管理员授权，点“是”，让它启用 SSH。
2. 保持手机和电脑在同一 Wi-Fi，或都接入同一个 Tailscale/ZeroTier 网络。
3. 打开 Litter，进入 Discovery / Remote Servers。
4. 选择添加 SSH server。
5. 填：

```text
Host: 192.168.2.109
Port: 22
Username: lthir
Working directory: F:\01.AI\17.AIRemoteCtl
```

密码使用 Windows 账户密码。Windows Hello PIN 通常不能用于 SSH。

可先在电脑上双击 `test-ssh-login.bat` 验证密码。出现密码提示时输入 Windows 账户密码；如果输出 `SSH_OK`，说明 Litter 也可以用同样的用户名和密码连接。

连接后，Litter 会通过 SSH 在电脑上解析 `codex.exe`，启动/复用 `codex app-server`，并通过 SSH tunnel 控制 Codex。不要把 `codex app-server` 直接绑定到公网地址。

如果 Litter 弹出 `Install Codex? / Codex not found on remote host`，先点 `Cancel`。然后重新双击 `start-airctl.bat`，允许管理员窗口完成 SSH/Codex PATH 修复，再回 Litter 重新连接。

## 后续可扩展

- 二维码配对和一次性 token
- 线程列表、历史恢复、停止 turn
- Tailscale/SSH 自动发现
- 后台推送通知
- 原生 App 包装同一个 HTTP/WebSocket 协议
