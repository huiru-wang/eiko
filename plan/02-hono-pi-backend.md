# Task 2: Hono + Pi 后端工程

> 依赖：[01-monorepo-init.md](./01-monorepo-init.md)
> 参考项目：`/Users/whr/workspace/dsh-agent/pi-agent`

## 目标

在 `apps/server/` 中创建完整的 Hono + pi-agent-core 后端工程骨架，并同步更新架构文档。

## 步骤

### 2.1 包配置

**`apps/server/package.json`**
```jsonc
{
  "name": "@eiko/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "typecheck": "tsc --noEmit",
    "db:migrate": "tsx src/infrastructure/migrate.ts"
  },
  "dependencies": {
    "@eiko/shared": "workspace:*",
    "hono": "^4.x",
    "@hono/node-server": "^2.x",
    "@earendil-works/pi-agent-core": "^0.84.x",
    "@earendil-works/pi-ai": "^0.84.x",
    "better-sqlite3": "^11.x",
    "kysely": "^0.27.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "tsx": "^4.x",
    "typescript": "^7.x",
    "@types/node": "^26.x",
    "@types/better-sqlite3": "^7.x"
  }
}
```

**`apps/server/tsconfig.json`** -- extends base, `module: Node16`, `moduleResolution: Node16`

**`apps/server/.env.example`** -- PROVIDER, MODEL, SQLITE_PATH, PORT, HOST, ORGANIZER_TRIGGER_CRON

### 2.2 核心入口

参照 `dsh-agent/pi-agent` 模式：

- **`src/main.ts`** -- loadEnv() → loadConfig() → initDatabase() → SessionManager → createApp() → startServer()
- **`src/env.ts`** -- AppConfig（provider, model, sqlitePath, sessionsDir, promptsDir, port, host, organizerCron）
- **`src/server.ts`** -- Hono App 构造，注册 CORS，挂载 routes

### 2.3 Agent 模块 (`src/agent/`)

集中管理所有 Agent 相关文件：

- **`runtime.ts`** -- createAgentRuntime()：解析模型（builtinModels）、注册工具、加载 Prompts、构造 `new Agent({ streamFn, initialState })`
- **`session.ts`** -- SessionManager：`WorkspaceKey = userId:sessionId`，per-thread AgentRuntime 生命周期，同 Workspace 串行
- **`persistence.ts`** -- Agent 运行后消息写入 SQLite messages 表（payload 存完整 Pi JSON），支持 Compaction
- **`prompts/`** -- chat.prompt.ts、record-digest.prompt.ts、topic-organize.prompt.ts
- **`tools/`** -- search-records.tool.ts、read-topic.tool.ts

### 2.4 Routes (`src/routes/`)

- **`records.ts`** -- POST /api/records, GET /api/records（分页）
- **`topics.ts`** -- GET /api/topics（分页）, GET /api/topics/:topicId（详情 + relatedRecords）
- **`messages.ts`** -- GET /api/messages（Topic 下 Message 历史）
- **`agent.ts`** -- POST /api/agent/stream（SSE 流式，agent.subscribe() → AgentEvent → SSE frame）

### 2.5 Application 层 (`src/application/`)

- `create-record.service.ts` -- 创建 Record 并返回
- `process-record.service.ts` -- Record 消化（Agent 判断关联/创建 Topic）
- `topic-chat.service.ts` -- Topic 对话（Agent 流式回复 + TopicAction 提取）
- `organize-topic.service.ts` -- Topic 自动整理（Agent 重写 Markdown）

### 2.6 Modules (`src/modules/`)

- **`record/`** -- record.ts（实体）, record.repository.ts（端口接口）
- **`topic/`** -- topic.ts, topic-action.ts, record-topic.ts, topic.repository.ts
- **`message/`** -- message.ts, message.repository.ts

### 2.7 Scheduler (`src/scheduler/`)

- `scheduler.ts` -- 轻量进程内调度器
- `organizer-trigger.ts` -- 扫描 pending Records + needsOrganize Topics → 分组 → 调用 Agent

### 2.8 Infrastructure (`src/infrastructure/`)

- **`database.ts`** -- better-sqlite3 + WAL + Kysely 初始化
- **`schema.ts`** -- Kysely Database 类型定义
- **`migrations/`** -- 001_create_users.ts, 002_create_records.ts, 003_create_topics.ts, 004_create_record_topics.ts, 005_create_messages.ts
- **`repositories/`** -- sqlite-record.repository.ts, sqlite-topic.repository.ts, sqlite-message.repository.ts

### 2.9 更新架构文档

**`docs/server/architecture.md`** -- 大量修改：
- 方案定稿和技术栈：Fastify → Hono, TypeBox → Zod, Pino → console
- 流式协议：NDJSON chunked → SSE（pi 原生 AgentEvent）
- Agent Runtime：pi-agent-core Agent + subscribe() 模式
- Session：SessionManager（per-thread AgentRuntime）
- 消息持久化：SQLite messages 表，payload 存完整 Pi JSON
- Agent 集中到 src/agent/ 模块
- 目录结构、模块依赖图更新

**`docs/frontend-architecture.md`** -- 中等修改：
- Agent Stream：`wx.request(enableChunked)` + NDJSON → SSE 解析
- Monorepo 描述更新

**`docs/README.md`** -- 同步更新：
- 系统架构图、技术栈表、目录结构、环境变量
- Monorepo 描述

**`docs/api-definition.md`** -- 小量修改：
- 流式接口：NDJSON → SSE
- 校验：TypeBox → Zod

### 2.10 验证

```bash
pnpm typecheck              # 类型检查通过
pnpm start                  # 服务启动成功（需 .env）
pnpm db:migrate             # 数据库迁移成功
```
