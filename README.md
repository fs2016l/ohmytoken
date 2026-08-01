# ohmytoken

> 本地 AI Agent Token 用量观测桌面应用

一款桌面端应用，自动扫描本机各类 AI Agent（Claude Code、Codex、OpenCode、Kimi Work 等）的 Token 使用记录，提供可视化的用量统计与趋势分析，帮助你掌握多 Agent 多模型的 Token 消耗全貌。

所有数据均从本地读取，无需手动填报。

## 功能特性

- **多 Agent 扫描**：自动发现并解析本机 9 类 AI Agent 的用量数据
- **多维度统计**：总览 / 每日趋势 / 每月汇总 / 模型维度 / Agent 维度 / 环比对比
- **可视化仪表盘**：基于 ECharts 的交互式图表（饼图 / 趋势线 / 数据表格）
- **中英双语**：界面语言实时切换
- **暗亮主题**：跟随偏好切换
- **自动更新**：内置 electron-updater，新版本提示与一键安装
- **数据本地化**：扫描结果加密落盘，不外传

## 支持的 Agent

| Agent        | 标识           | 数据源                                                                                      | 说明                               |
| ------------ | -------------- | ------------------------------------------------------------------------------------------- | ---------------------------------- |
| Claude Code  | `claude-code`  | `~/.claude/projects/**`                                                                     | 完整解析                           |
| Codex        | `codex`        | `~/.codex/state_5.sqlite` + `~/.codex/sessions/**` + `~/.codex/archived_sessions/**`        | SQLite 会话索引 + rollout 明细解析 |
| OpenCode     | `opencode`     | `~/.local/share/opencode/opencode.db`                                                       | SQLite 读取                        |
| Z Code       | `zcode`        | `~/.zcode/cli/db/db.sqlite`                                                                 | model_usage 优先，兼容旧版 message |
| Kimi Work    | `kimiwork`     | `%APPDATA%/kimi-desktop/...`；macOS `~/Library/Application Support/...`、`~/.kimi/sessions` | 完整解析                           |
| MiniMax Code | `minimax-code` | Windows/macOS 3.x `~/.minimax/v2/sqlite/runtime-state.sqlite`                               | 完整解析                           |
| WorkBuddy    | `workbuddy`    | `~/.workbuddy/projects/**/*.jsonl` + `~/.workbuddy/workbuddy.db` + `~/.workbuddy/traces/**` | JSONL 明细优先，DB/trace 补充      |
| Trae         | `trae`         | `%APPDATA%/Trae CN`                                                                         | 仅检测安装                         |
| Qoder        | `qoder`        | `%APPDATA%/Local/.qoder-cn`                                                                 | 仅检测安装                         |

## 技术栈

- **Electron 33** — 跨平台桌面框架（三进程架构：main / preload / renderer）
- **Vue 3.5 + TypeScript** — 渲染进程 UI
- **electron-vite** — 构建与开发工具链
- **ECharts** — 数据可视化
- **sql.js** — 本地 SQLite 读取（WebAssembly）
- **electron-updater** — 自动更新
- **ESLint 9 + Prettier** — 代码规范

## 环境要求

- **Node.js** 18+（Electron 33 最低要求）
- **操作系统**：Windows（NSIS）/ macOS（DMG）

## 快速开始

### 开发模式

```bash
cd desktop
npm install
npm run dev
```

启动后 electron-vite 会拉起主进程与渲染进程热更新。

### 类型检查

```bash
npm run typecheck   # node + web 双 tsconfig
```

### 代码规范

```bash
npm run lint        # 检查
npm run lint:fix    # 自动修复
npm run format      # Prettier 格式化
```

## 打包发布

```bash
npm run build:win   # 打包 Windows x64 NSIS 安装包
npm run build:mac   # 打包 macOS DMG（x64 + arm64）
```

产物输出到 `desktop/release/<version>/`。

## 项目结构

```
desktop/
├── src/
│   ├── main/          # 主进程（扫描器 / 服务 / IPC / 自动更新）
│   │   ├── scanners/  # 9 个 Agent 扫描器实现
│   │   ├── services/  # 扫描 / 统计 / 认证 / 存储 / 更新等服务
│   │   └── ipc/       # IPC 通道与处理器
│   ├── preload/       # 预加载脚本（contextBridge）
│   └── renderer/      # 渲染进程（Vue 3 应用）
│       ├── api/       # 本地 IPC 与远程 HTTP 封装
│       ├── components/    # UI 组件
│       ├── composables/   # 组合式函数
│       ├── views/     # 页面
│       └── i18n/      # 中英双语
├── resources/         # sql-wasm.wasm 等打包资源
└── electron-builder.yml
```

## 可选：连接后端服务

本应用本地扫描与统计功能独立可用。若需登录态同步、套餐信息、AI 信息差资讯、用户反馈等联网能力，可配置连接配套的后端服务（需另行部署）：

- 官方正式构建在 `desktop/.env.production` 配置唯一的公开 `MAIN_VITE_OHMYTOKEN_API_BASE`；本地覆盖文件不会进入公开仓库。
- 私有部署仍可用运行时环境变量 `OHMYTOKEN_API_BASE` 覆盖。
- 登录页、账号页、官网、帮助、隐私政策与 electron-updater 更新源均由该 API 的 `/desktop/bootstrap` 动态下发，并由 com 管理后台维护。

Agent 是开源客户端，仓库和安装包中只允许出现公开 API Base；不得放入 COS/CAM/CDN 密钥、数据库地址/密码或任何服务端 Token。生产 HTTP 仅允许本机联调地址，其余运行 URL 必须为 HTTPS。

不配置时，上述联网功能不可用，但不影响本地核心功能。

## 法律文件

- [Oh My Token Agent 用户协议](https://ohmytoken.net/legal/agent-terms)
- [Oh My Token Agent 隐私政策](https://ohmytoken.net/legal/agent-privacy)

## 许可证

本仓库中由本项目原创的桌面客户端源码采用 [MIT License](LICENSE)。

ohmytoken 官方托管 API、服务器资源及服务端源码不包含在本许可证的授权范围内；
使用官方托管服务须遵守另行公布的服务与 API 使用条款。

客户端包含的第三方字体、图标及其他第三方组件继续适用各自的许可证。
字体和图标的许可证文本见
[`desktop/third-party-licenses`](desktop/third-party-licenses)，并会随官方安装包一同分发。
