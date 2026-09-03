
# Record 沉思整理 Agent 重构方案（Contemplate）

## 一、整体架构

```
HTTP 触发 (POST /api/contemplate)
    │
    ▼
创建 Task (status=pending)
    │
    ▼
更新 Task (status=planning)
    │
    ▼
Agent 接收 Prompt（内联 30 条 Record 完整内容 + Topic 概览）
    │
    ├─ Plan 阶段：分析 Record-Topic 关系，产出 plan JSON
    │   └─ update_task(status=planning, result.plan)
    │
    ├─ Execute 阶段（同一 Agent session 继续）
    │   ├─ merge: get_topic → 理解 → update_topic
    │   ├─ create: 理解 records → create_topic
    │   └─ 每项完成后 update_task(result.execution[planId])
    │
    └─ Verify 阶段（当前直接通过）
        └─ update_task(status=completed)
```

Agent 使用独立于 Topic 对话的 tool 集合（harness 不同）。

---

## 二、Task 表

### 2.1 表结构

新建 migration: `src/infrastructure/migrations/create_tasks.ts`

```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,          -- "contemplate" | "topic_organize" | ...
  status      TEXT NOT NULL DEFAULT 'pending',
  input       TEXT,                   -- JSON
  result      TEXT,                   -- JSON
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### 2.2 Task 模块

```
src/modules/task/
├── task.ts                    -- Task 实体 + 类型定义
└── task.repository.ts         -- TaskRepository 接口
```

**Task 实体：**

```ts
export type TaskType = "contemplate" | "topic_organize";
export type TaskStatus = "pending" | "planning" | "executing" | "verifying" | "completed" | "failed";

export interface Task {
  id: string;
  userId: string;
  type: TaskType;
  status: TaskStatus;
  input: Record<string, any> | null;
  result: Record<string, any> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
```

**TaskRepository 接口：**

```ts
export interface TaskRepository {
  create(input: { userId: string; type: TaskType; input: Record<string, any> }): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  update(id: string, patch: Partial<Pick<Task, "status" | "result" | "error">>): Promise<void>;
  findByUserId(userId: string, opts: { limit: number }): Promise<Task[]>;
}
```

### 2.3 result JSON 结构

```json
{
  "plan": {
    "items": [
      {
        "id": "plan-1",
        "recordIds": ["r1", "r2"],
        "action": "merge",
        "targetTopicId": "t1",
        "reason": "..."
      },
      {
        "id": "plan-2",
        "recordIds": ["r3"],
        "action": "create",
        "proposedTitle": "...",
        "proposedSummary": "...",
        "reason": "..."
      }
    ],
    "skipped": [
      { "recordId": "r4", "reason": "临时备忘，不含值得沉淀的思考" }
    ]
  },
  "execution": {
    "plan-1": { "status": "done", "topicId": "t1", "action": "updated" },
    "plan-2": { "status": "done", "topicId": "t-new", "action": "created" }
  },
  "verification": {
    "passed": true,
    "unresolved": []
  }
}
```

### 2.4 update_task 工具的状态/字段约束

| 可更新的 status | 可写入的 result 子字段 |
|---|---|
| `planning` | `plan`（整个 plan 对象） |
| `executing` | `execution[planId]`（单项执行结果） |
| `verifying` | `verification`（验证结果） |
| `completed` | 无额外字段（仅更新 status） |
| `failed` | `error`（失败原因） |

---

## 三、ChromaDB 向量服务

参照 rumi-ai 方案（`/Users/whr/workspace/rumi-ai/backend/src/storage/vector_store.py`）。

### 3.1 ChromaDB 独立服务

ChromaDB 作为独立 HTTP 服务运行（Docker 或直接 `chroma run`），不与 Eiko 进程耦合。

- 环境变量：`CHROMA_HOST`（默认 127.0.0.1）、`CHROMA_PORT`（默认 8000）
- 通过 `chromadb.HttpClient` 连接
- Collection 策略：**两个 collection**
  - `eiko_records` — 存储 record 内容向量
  - `eiko_topics` — 存储 topic 内容向量
- 相似度：cosine
- 启动方式：`docker run -p 8000:8000 chromadb/chroma` 或本地 `chroma run --path ./data/chroma --port 8000`

### 3.2 Embedding 模型

参照 rumi-ai 使用 Dashscope text-embedding-v2：
- 环境变量：`EMBEDDING_API_KEY`、`EMBEDDING_API_BASE`、`EMBEDDING_MODEL`（默认 text-embedding-v2）
- 备选：OpenAI 兼容的 embedding 接口（复用 `OPENAI_API_KEY` + `OPENAI_API_BASE`）

新增依赖：`chromadb`（npm: `chromadb`）

### 3.3 VectorStore 封装

新文件：`src/infrastructure/vector-store.ts`

```ts
export interface VectorChunk {
  id: string;             // chunk 唯一 ID
  text: string;           // 文本内容
  metadata: Record<string, any>;  // recordId/topicId, userId, title, ...
}

export interface VectorStore {
  // 写入/更新
  upsertRecord(record: { id: string; content: string; userId: string }): Promise<void>;
  upsertTopic(topic: { id: string; title: string; summary: string; bodyMarkdown: string; userId: string }): Promise<void>;
  // 删除
  deleteRecord(id: string): Promise<void>;
  deleteTopic(id: string): Promise<void>;
  // 搜索
  search(opts: { scope: "record" | "topic"; query: string; topK: number; userId: string }): Promise<SearchResult[]>;
}
```

ChromaDB metadata 设计：

- Record chunk metadata: `{ recordId, userId }`
- Topic chunk metadata: `{ topicId, userId, title }`

搜索结果直接返回 `recordId` 或 `topicId` 供 Agent 后续调用 `get_topic` / `get_record`。

### 3.4 数据同步机制

在 **创建/更新 Record 和 Topic 后**，同步写入 ChromaDB。

涉及文件变更：

| 操作 | 触发位置 | 调用方法 |
|---|---|---|
| 创建 Record | `routes/records.ts` POST | `vectorStore.upsertRecord(record)` |
| 更新 Topic | `tools/contemplate.tools.ts` update_topic | `vectorStore.upsertTopic(topic)` |
| 创建 Topic | `tools/contemplate.tools.ts` create_topic | `vectorStore.upsertTopic(topic)` |

注意：contemplate Agent 内部调用 create_topic / update_topic 时也要同步。因此 contemplate.tools.ts 中的工具函数需要接收 vectorStore 参数。

---

## 四、Agent Tools（沉思任务专用）

与 Topic 对话 Agent 使用**不同的 harness**（不同的 tool 集合）。

### 4.1 工具清单

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `rag_search` | `scope: "record" \| "topic"`, `query: string` | 匹配结果列表（recordId/topicId + 摘要） | 关键词搜索，通过 ChromaDB 向量检索 |
| `get_topic` | `topicId: string` | Topic 完整详情 JSON | 即现有 `read_topic`，改名 |
| `get_record` | `recordId: string` | Record 完整内容 JSON | 新增 |
| `create_topic` | `title, summary, tags, bodyMarkdown, matchText?` | 新建 Topic JSON | 现有，增加 vectorStore 同步 |
| `update_topic` | `topicId, title?, summary?, tags?, bodyMarkdown?, matchText?` | 更新后 Topic JSON | 现有，增加 vectorStore 同步 |
| `update_task` | `status, result?` | 确认信息 | 新增，写入 task 表 |

### 4.2 工具文件组织

```
src/agent/tools/
├── contemplate.tools.ts       -- 沉思任务专用工具集工厂（替代原 topic.tools.ts）
│   ├── createRagSearchTool()
│   ├── createGetTopicTool()      -- 改名自 read_topic
│   ├── createGetRecordTool()     -- 新增
│   ├── createCreateTopicTool()   -- 增强：增加 vectorStore 同步
│   ├── createUpdateTopicTool()   -- 增强：增加 vectorStore 同步
│   ├── createUpdateTaskTool()    -- 新增
│   └── createContemplateTools()  -- 工厂函数，一次返回全部 6 个 tools
```

删除旧文件：`src/agent/tools/topic.tools.ts`（功能已合并到 contemplate.tools.ts）

### 4.3 rag_search 工具详细设计

```ts
// 入参
{
  scope: "record" | "topic",   // 搜索目标类型
  query: string                 // 搜索关键字（Agent 根据待整理 record 自行提炼）
}

// 返回
[
  {
    recordId?: string,         // scope=record 时有值
    topicId?: string,          // scope=topic 时有值
    title?: string,            // topic 有 title，record 无
    snippet: string,           // 匹配文本片段
    score: number              // 相关度分数（ChromaDB distance）
  }
]
```

实现：调用 `vectorStore.search({ scope, query, topK: 10, userId })`，返回结果格式化。

### 4.4 update_task 工具详细设计

```ts
// 入参
{
  status: "planning" | "executing" | "verifying" | "completed" | "failed",
  result?: {
    plan?: { items: PlanItem[], skipped: SkippedItem[] },           // status=planning 时
    execution?: Record<string, ExecutionResult>,                     // status=executing 时
    verification?: { passed: boolean, unresolved: string[] },       // status=verifying 时
  },
  error?: string                                                     // status=failed 时
}
```

实现：调用 `taskRepo.update(taskId, { status, result: merge(existingResult, newResult) })`。

关键：result 是**增量合并**，不是覆盖。每次 update_task 只写入对应阶段的字段。

---

## 五、Contemplate Prompt

### 5.1 Prompt 文件

重写 `src/agent/prompts/contemplate.prompt.ts`（原 record-digest.prompt.ts 改名）。

### 5.2 Prompt 结构

```
[SYSTEM_PROMPT — Eiko 角色定义，不变]

[任务说明]
你正在执行 Record 沉思整理任务。任务分三个阶段：Plan → Execute → Verify。

[工具说明]
你可以使用以下工具：
- rag_search(scope, query): 搜索相关 topic 或 record
- get_topic(topicId): 获取 topic 完整详情
- get_record(recordId): 获取 record 完整内容
- create_topic(...): 创建新 topic
- update_topic(...): 更新已有 topic
- update_task(status, result): 更新任务状态和结果

[Plan 阶段]
1. 阅读以下待整理的 Record
2. 使用 rag_search 查找可能与这些 Record 相关的已有 Topic
3. 分析每条 Record 与已有 Topic 的关系，产出整理计划
4. 通过 update_task(status="planning") 写入 plan

Plan JSON 格式：
{
  "plan": {
    "items": [
      {
        "id": "plan-{序号}",
        "recordIds": [...],
        "action": "merge" | "create",
        "targetTopicId": "...",      // action=merge 时必填
        "proposedTitle": "...",       // action=create 时必填
        "proposedSummary": "...",     // action=create 时必填
        "reason": "..."
      }
    ],
    "skipped": [
      { "recordId": "...", "reason": "..." }
    ]
  }
}

跳过规则：
- 纯临时信息（如"帮我记一下明天3点开会"）→ 跳过
- 信息密度极低（如"今天天气不错"）→ 跳过
- 独立但信息丰富的记录 → 不跳过，action=create

[Execute 阶段]
按 plan 逐项执行：
- merge: get_topic 获取完整内容 → 结合 record 重新思考 → update_topic 提交完整新内容
- create: 理解 record → create_topic 创建新 topic
每项完成后 update_task(status="executing", result={ execution: { "plan-N": { status: "done", topicId, action } } })

[Verify 阶段]
当前阶段直接通过：update_task(status="completed")

[输入数据]
当前时间：{currentTime}
任务 ID：{taskId}

待整理的 Record（共 {count} 条）：
---
[Record ID: {id}]
{content}
---
...（最多 30 条，完整内容内联）

用户当前 Topics 概览（共 {topicCount} 个）：
{topicsSummary: id + title + summary + tags}
```

### 5.3 Prompt 中的 Record 内联策略

- 直接内联 Record 完整内容，上限 30 条
- Topics 只内联摘要（id + title + summary + tags），Agent 需要详情时通过 `get_topic` 获取
- 如果 pending record 超过 30 条，本次 task 只处理前 30 条，剩余留给下次任务

---

## 六、Contemplate 服务

重写 `src/agent/contemplate.service.ts`（原 digest.service.ts 改名）：

```ts
export async function runContemplate(opts: ContemplateOptions): Promise<ContemplateResult> {
  // 1. 获取 pending records（最多 30 条）
  const pending = await recordRepo.findByUserId(userId, { limit: 30 });
  if (pending.length === 0) return early;

  // 2. 获取所有 topics 摘要
  const topics = await topicRepo.findByUserId(userId, { limit: 200 });

  // 3. 创建 Task
  const task = await taskRepo.create({
    userId,
    type: "contemplate",
    input: { recordIds: pending.map(r => r.id) }
  });

  // 4. 更新 Task → planning
  await taskRepo.update(task.id, { status: "planning" });

  // 5. 构造 Agent（独立实例，沉思专用 tools）
  const tools = createContemplateTools({ recordRepo, topicRepo, taskRepo, vectorStore, userId, taskId: task.id });
  const agent = new Agent({
    streamFn, sessionId: `${userId}:contemplate:${task.id}`,
    initialState: { model, systemPrompt: SYSTEM_PROMPT, tools }
  });

  // 6. 构造 prompt（内联 records + topic 概览）
  const userMessage = buildContemplatePrompt(pending, topics, task.id);

  // 7. 发送消息并等待完成
  await agent.prompt(userMessage);
  await agent.waitForIdle();

  // 8. 后处理：更新 record 状态
  const finalTask = await taskRepo.findById(task.id);
  const plan = finalTask?.result?.plan;
  if (plan) {
    // 被整理的 record → organized
    for (const item of plan.items ?? []) {
      for (const rid of item.recordIds) {
        await recordRepo.updateStatus(rid, "organized");
      }
    }
    // 被跳过的 record → skipped
    for (const skip of plan.skipped ?? []) {
      await recordRepo.updateStatus(skip.recordId, "skipped");
    }
  }

  // 9. 返回结果
  return { taskId: task.id, ... };
}
```

---

## 七、Record 状态流转

更新 `src/modules/record/record.ts`：

```ts
export type RecordStatus = "pending" | "organized" | "skipped";
```

- `pending` — 新创建，等待沉思整理
- `organized` — 已被 Agent 沉思整理到 Topic
- `skipped` — Agent 判断不值得沉淀

---

## 八、HTTP 路由更新

更新 `src/routes/contemplate.ts`（原 digest.ts 改名）：

```
POST /api/contemplate        -- 触发沉思任务，返回 { taskId, status }
GET  /api/contemplate/tasks  -- 列出用户的沉思任务列表
GET  /api/contemplate/:id    -- 获取单个任务详情（含 plan + execution 结果）
```

---

## 九、新增/变更文件清单

### 新增文件

| 文件 | 说明 |
|---|---|
| `src/infrastructure/migrations/create_tasks.ts` | Task 表 migration |
| `src/infrastructure/schema.ts` (修改) | 增加 tasks 表 schema |
| `src/modules/task/task.ts` | Task 实体 |
| `src/modules/task/task.repository.ts` | TaskRepository 接口 |
| `src/infrastructure/repositories/sqlite-task.repository.ts` | TaskRepository SQLite 实现 |
| `src/infrastructure/vector-store.ts` | ChromaDB VectorStore 封装 |
| `src/agent/tools/contemplate.tools.ts` | 沉思任务专用 6 个工具 |
| `scripts/start-backend.sh` | 后端完整启动脚本（含 ChromaDB + 迁移 + 服务） |

### 修改文件

| 文件 | 变更 |
|---|---|
| `src/modules/record/record.ts` | RecordStatus 改为 pending/organized/skipped |
| `src/agent/prompts/contemplate.prompt.ts` | 重写为三阶段 Prompt（原 record-digest.prompt.ts） |
| `src/agent/contemplate.service.ts` | 重写沉思服务（原 digest.service.ts，Task 创建、三阶段、record 状态更新） |
| `src/routes/contemplate.ts` | 增加 GET 路由，POST 返回 taskId（原 digest.ts） |
| `src/routes/records.ts` | 创建 record 后同步 vectorStore |
| `src/server.ts` | 注入 taskRepo + vectorStore 依赖 |
| `src/main.ts` | 初始化 VectorStore + TaskRepository |
| `src/env.ts` | 增加 CHROMA_HOST/PORT + EMBEDDING 环境变量 |
| `.env.example` | 增加 ChromaDB + Embedding 环境变量 |

### 删除文件

| 文件 | 原因 |
|---|---|
| `src/agent/tools/topic.tools.ts` | 功能合并到 contemplate.tools.ts |

---

## 十、环境变量新增

```env
# ChromaDB
CHROMA_HOST=127.0.0.1
CHROMA_PORT=8000

# Embedding
EMBEDDING_API_KEY=
EMBEDDING_API_BASE=
EMBEDDING_MODEL=text-embedding-v2
```

---

## 十一、实施顺序

1. Task 模块：migration + entity + repository 接口 + SQLite 实现
2. VectorStore：ChromaDB 封装 + 连接测试
3. Record 状态流转：更新 entity + migration
4. Contemplate Tools：6 个工具实现
5. Contemplate Prompt：三阶段 prompt 重写
6. Contemplate Service：核心编排逻辑重写
7. 路由更新：contemplate 路由 + records 路由增加向量同步
8. 服务启动：main.ts/server.ts 注入新依赖
9. 端到端验证：创建 records → 触发 contemplate → 验证 plan + execution 结果

---

## 十二、ChromaDB 启动方式

开发阶段使用 Docker：

```bash
docker run -d --name eiko-chroma -p 8000:8000 chromadb/chroma
```

或本地安装：

```bash
pip install chromadb
chroma run --path ./data/chroma --port 8000
```

数据持久化目录：`./data/chroma`（已在 .gitignore 中排除 data/）

---

## 十三、启动脚本

新建 `scripts/start-backend.sh`，一键启动完整后端服务：

```bash
#!/usr/bin/env bash
set -e

# 1. 检查并启动 ChromaDB（如果未运行）
if ! curl -s http://127.0.0.1:8000/api/v1/heartbeat > /dev/null 2>&1; then
  echo "Starting ChromaDB..."
  docker run -d --name eiko-chroma -p 8000:8000 chromadb/chroma 2>/dev/null \
    || docker start eiko-chroma 2>/dev/null \
    || { echo "ChromaDB not available, please start manually"; exit 1; }
  # 等待 ChromaDB 就绪
  for i in $(seq 1 30); do
    curl -s http://127.0.0.1:8000/api/v1/heartbeat > /dev/null 2>&1 && break
    sleep 1
  done
fi
echo "ChromaDB is ready."

# 2. 数据库迁移
cd apps/backend
pnpm db:migrate

# 3. 启动后端服务
PORT=3000 pnpm start
```

使用方式：

```bash
# 在 eiko 项目根目录执行
bash scripts/start-backend.sh
```

脚本职责：
1. 检查 ChromaDB 是否已运行，未运行则自动启动 Docker 容器
2. 等待 ChromaDB heartbeat 就绪（最多 30s）
3. 执行 SQLite 数据库迁移
4. 启动 Hono 后端服务
