
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
Agent 接收 Prompt（内联 30 条 Record 完整内容 + 最近 Topic 概览）
    │
    ├─ Plan 阶段：分析 Record-Topic 关系，产出 plan JSON
    │   └─ update_task(status=planning, result.plan)
    │
    ├─ Execute 阶段（同一 Agent session 继续）
    │   ├─ merge: get_topic → 理解 → update_topic → link_record_topic
    │   ├─ create: 理解 records → create_topic → link_record_topic
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
    "plan-1": { "status": "done", "topicId": "t1", "action": "updated", "linkedRecordIds": ["r1", "r2"] },
    "plan-2": { "status": "done", "topicId": "t-new", "action": "created", "linkedRecordIds": ["r3"] }
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

## 三、sqlite-vec 向量索引

MVP 阶段采用 `sqlite-vec`，不引入独立向量数据库服务。向量数据作为 SQLite 内的**可重建索引层**存在，业务真相仍然保存在 `records`、`topics`、`record_topics`、`messages` 等主表。

核心查询链路：

```
输入文本
    │
    ▼
生成 embedding
    │
    ▼
sqlite-vec 相似召回 topK
    │
    ▼
返回 recordId / topicId
    │
    ▼
回 SQLite 主表读取完整业务数据
    │
    ▼
Agent / 业务规则做最终判断
```

向量搜索只负责候选召回，不直接决定 Record 是否关联 Topic。

### 3.1 sqlite-vec 集成方式

- 与现有 `better-sqlite3` 同进程运行，不需要单独启动向量数据库服务。
- 后端直接依赖 `sqlite-vec` npm 包，在数据库初始化时对同一个 `better-sqlite3` 实例调用 `sqliteVec.load(db)`，并执行 `select vec_version()` 做启动期可用性检查。
- 继续使用当前 SQLite WAL 配置。并发能力遵循 SQLite：读多写少适合，单写者模型，不适合高频并发写。
- 新增依赖：`sqlite-vec`。
- 向量表和向量数据持久化在 `SQLITE_PATH` 指向的同一个 `.sqlite` 文件里。

### 3.2 向量表策略

采用 **两张 vec0 虚拟表**，分别承载 Topic 与 Record 的语义索引：

```sql
CREATE VIRTUAL TABLE vec_topics USING vec0(
  topic_id TEXT PRIMARY KEY,
  user_id TEXT PARTITION KEY,
  embedding FLOAT[1536],
  updated_at TEXT,
  +embedding_text TEXT
);
```

```sql
CREATE VIRTUAL TABLE vec_records USING vec0(
  record_id TEXT PRIMARY KEY,
  user_id TEXT PARTITION KEY,
  embedding FLOAT[1536],
  occurred_at TEXT,
  +embedding_text TEXT
);
```

选择两张表而不是一张 `entity_type + entity_id` 混合表的原因：

| 维度 | Topic 向量 | Record 向量 |
|---|---|---|
| embedding 文本 | `title + summary + tags + matchText + 少量正文` | 用户原始 `content` |
| 生命周期 | Topic 创建和整理后更新 | Record 创建后基本不变 |
| 搜索入口 | 新 Record 找相似 Topic | Topic / 对话找相关原始记忆 |
| 返回 ID | `topicId` | `recordId` |
| 后处理 | Agent 判断 link/create/skip | 回查原始 Record 内容 |

一张表也能实现，但每次查询都必须依赖 `entity_type` 过滤，代码和数据约束更松。当前项目的领域模型已经明确区分 Record 与 Topic，MVP 采用两张表更简单、直观。

### 3.3 查询方式

搜索相似 Topic：

```sql
SELECT topic_id, distance
FROM vec_topics
WHERE embedding MATCH ?
  AND user_id = ?
  AND k = 10
ORDER BY distance;
```

搜索相似 Record：

```sql
SELECT record_id, distance
FROM vec_records
WHERE embedding MATCH ?
  AND user_id = ?
  AND k = 20
ORDER BY distance;
```

查询返回的 `topic_id` / `record_id` 只作为桥接 ID，后续必须回主表读取完整 Topic / Record。

### 3.4 Embedding 模型

参照 rumi-ai 使用 Dashscope text-embedding-v2：
- 环境变量：`EMBEDDING_API_KEY`、`EMBEDDING_API_BASE`、`EMBEDDING_MODEL`（默认 text-embedding-v2）
- 备选：OpenAI 兼容的 embedding 接口（复用 `OPENAI_API_KEY` + `OPENAI_API_BASE`）

需要固定 embedding 维度并与 vec0 表结构一致。若更换 embedding 模型，需要重建 `vec_topics` 和 `vec_records`。

### 3.5 VectorStore 封装

新文件：`src/infrastructure/vector-store.ts`

```ts
export interface VectorStore {
  // 写入/更新
  upsertRecord(record: { id: string; content: string; userId: string }): Promise<void>;
  upsertTopic(topic: { id: string; title: string; summary: string; tags: string[]; matchText: string; bodyMarkdown: string; userId: string }): Promise<void>;
  // 删除
  deleteRecord(id: string): Promise<void>;
  deleteTopic(id: string): Promise<void>;
  // 搜索
  searchTopics(opts: { query: string; topK: number; userId: string }): Promise<TopicVectorSearchResult[]>;
  searchRecords(opts: { query: string; topK: number; userId: string }): Promise<RecordVectorSearchResult[]>;
}
```

搜索结果设计：

```ts
export interface TopicVectorSearchResult {
  topicId: string;
  distance: number;
  embeddingText: string;
}

export interface RecordVectorSearchResult {
  recordId: string;
  distance: number;
  embeddingText: string;
}
```

`embeddingText` 仅用于调试、snippet 和 Agent 初筛，不作为业务真相。

### 3.6 数据同步机制

目标原则：Record / Topic 主表写入与向量索引写入最终保持一致。

MVP 实现策略：

- Record 创建以主表写入成功为准，优先保证捕获入口稳定；
- 向量化可以在请求返回后异步执行，失败时记录日志；
- Topic 创建/更新后同步刷新 `vec_topics`，失败不回滚 Topic 主表；
- 如果向量化失败较多，再增加待向量化状态或补偿任务，由定时任务重试。

涉及文件变更：

| 操作 | 触发位置 | 调用方法 |
|---|---|---|
| 创建 Record | `routes/records.ts` POST | `vectorStore.upsertRecord(record)` |
| 更新 Topic | `tools/contemplate.tools.ts` update_topic | `vectorStore.upsertTopic(topic)` |
| 创建 Topic | `tools/contemplate.tools.ts` create_topic | `vectorStore.upsertTopic(topic)` |

注意：contemplate Agent 内部调用 create_topic / update_topic 时也要同步。因此 contemplate.tools.ts 中的工具函数需要接收 vectorStore 参数。

### 3.7 索引重建

向量索引必须可重建：

- 新增脚本：`scripts/rebuild-vector-index.ts`
- 清空 `vec_topics`、`vec_records`
- 扫描主表中的 active topics 和 records
- 重新生成 embedding 并写入 sqlite-vec

重建触发场景：

- 首次接入向量索引；
- embedding 模型变更；
- embedding 文本拼接策略变更；
- 怀疑索引与主表不一致。

---

## 四、Agent Tools（沉思任务专用）

与 Topic 对话 Agent 使用**不同的 harness**（不同的 tool 集合）。

### 4.1 工具清单

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `rag_search` | `scope: "record" \| "topic"`, `query: string` | 匹配结果列表（recordId/topicId + 摘要） | 语义搜索，通过 sqlite-vec 向量检索 |
| `get_topic` | `topicId: string` | Topic 完整详情 JSON | 即现有 `read_topic`，改名 |
| `get_record` | `recordId: string` | Record 完整内容 JSON | 新增 |
| `create_topic` | `title, summary, tags, bodyMarkdown, matchText?` | 新建 Topic JSON | 现有，增加 vectorStore 同步 |
| `update_topic` | `topicId, title?, summary?, tags?, bodyMarkdown?, matchText?` | 更新后 Topic JSON | 现有，增加 vectorStore 同步 |
| `link_record_topic` | `recordId, topicId, relation?` | 确认信息 | 新增，写入 RecordTopic 关系表 |
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
│   ├── createLinkRecordTopicTool() -- 新增
│   ├── createUpdateTaskTool()    -- 新增
│   └── createContemplateTools()  -- 工厂函数，一次返回全部 7 个 tools
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
    score: number              // 相关度分数（sqlite-vec distance）
  }
]
```

实现：

- `scope="topic"`：调用 `vectorStore.searchTopics({ query, topK: 10, userId })`
- `scope="record"`：调用 `vectorStore.searchRecords({ query, topK: 10, userId })`
- 结果返回 `topicId` 或 `recordId`，再回主表补充 title/snippet 等信息后交给 Agent

### 4.4 link_record_topic 工具详细设计

```ts
// 入参
{
  recordId: string;
  topicId: string;
  relation?: "primary" | "secondary";
}
```

实现：调用 `topicRepo.linkRecord(recordId, topicId, relation)` 写入 `record_topics`。

约束：

- 同一 Record 自动关联 Topic 数量最多为 2；
- 写入前检查 Record 和 Topic 都属于当前 userId；
- 重复关联需要幂等处理；
- create / merge 执行成功后必须调用该工具，否则前端相关记忆和 Record Timeline 无法正确展示关联关系。

### 4.5 update_task 工具详细设计

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
- link_record_topic(recordId, topicId, relation): 建立 Record 与 Topic 的关系
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
- merge: get_topic 获取完整内容 → 结合 record 重新思考 → update_topic 提交完整新内容 → link_record_topic 关联本项 records
- create: 理解 record → create_topic 创建新 topic → link_record_topic 关联本项 records
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

用户最近 Topics 概览（用于向量索引不可用时降级，共 {topicCount} 个）：
{topicsSummary: id + title + summary + tags}
```

### 5.3 Prompt 中的 Record 内联策略

- 直接内联 Record 完整内容，上限 30 条
- Topics 只内联最近少量摘要（id + title + summary + tags），主流程优先通过 `rag_search(scope="topic")` 召回候选
- Agent 需要详情时通过 `get_topic` 获取完整 Topic
- 如果 pending record 超过 30 条，本次 task 只处理前 30 条，剩余留给下次任务

---

## 六、Contemplate 服务

重写 `src/agent/contemplate.service.ts`（原 digest.service.ts 改名）：

```ts
export async function runContemplate(opts: ContemplateOptions): Promise<ContemplateResult> {
  // 1. 在事务内领取待处理 records（最多 30 条）并创建 Task
  //    - 查询 pending / updated / skipped
  //    - 将本批 records 标记为 processing
  //    - 创建 Task，记录本次处理快照
  const { pending, task } = await taskRepo.createContemplateTaskWithRecords({
    userId,
    statuses: ["pending", "updated", "skipped"],
    limit: 30,
  });
  if (pending.length === 0) return early;

  // 2. 获取最近 topics 摘要，作为 rag_search 不可用时的降级上下文
  const topics = await topicRepo.findByUserId(userId, { limit: 50 });

  // 3. 更新 Task → planning
  await taskRepo.update(task.id, { status: "planning" });

  // 4. 构造 Agent（独立实例，沉思专用 tools）
  const tools = createContemplateTools({ recordRepo, topicRepo, taskRepo, vectorStore, userId, taskId: task.id });
  const agent = new Agent({
    streamFn, sessionId: `${userId}:contemplate:${task.id}`,
    initialState: { model, systemPrompt: SYSTEM_PROMPT, tools }
  });

  // 5. 构造 prompt（内联 records + topic 概览）
  const userMessage = buildContemplatePrompt(pending, topics, task.id);

  // 6. 发送消息并等待完成
  await agent.prompt(userMessage);
  await agent.waitForIdle();

  // 7. 后处理：更新 record 状态
  const finalTask = await taskRepo.findById(task.id);
  const plan = finalTask?.result?.plan;
  if (plan) {
    // 被整理并关联/创建 Topic 的 record → organized
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

  // 8. 返回结果
  return { taskId: task.id, ... };
}
```

---

## 七、Record 状态流转

更新 `src/modules/record/record.ts`：

```ts
export type RecordStatus = "pending" | "processing" | "organized" | "skipped" | "updated";
```

- `pending` — 新创建，等待沉思整理
- `processing` — 已被某个 Contemplate Task 领取，处理中；用于防止重复处理
- `organized` — 已被 Agent 沉思整理到 Topic，对应旧语义中的 `digested`
- `skipped` — 未找到合适 Topic，且信息量少或意义不足，本轮跳过；后续沉思整理仍可重新纳入
- `updated` — Record 后续被用户编辑或补充，需要重新沉思整理

Contemplate 每次只查询：

```ts
["pending", "updated", "skipped"]
```

不查询 `processing` 和 `organized`。

异常处理：

- Agent 执行失败时，Task 标记为 `failed`；
- 本次已领取但没有完成处理的 Record 从 `processing` 恢复到进入任务前的状态；
- 若进程异常退出导致残留 `processing`，后续可按 `updated_at` 超时扫描恢复。

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
| `src/infrastructure/migrations/create_vector_indexes.ts` | sqlite-vec 虚拟表 migration |
| `src/infrastructure/vector-store.ts` | sqlite-vec VectorStore 封装 |
| `scripts/rebuild-vector-index.ts` | 从主表重建向量索引 |
| `src/agent/tools/contemplate.tools.ts` | 沉思任务专用 7 个工具 |

### 修改文件

| 文件 | 变更 |
|---|---|
| `src/modules/record/record.ts` | RecordStatus 改为 pending/processing/organized/skipped/updated |
| `src/agent/prompts/contemplate.prompt.ts` | 重写为三阶段 Prompt（原 record-digest.prompt.ts） |
| `src/agent/contemplate.service.ts` | 重写沉思服务（原 digest.service.ts，Task 创建、三阶段、record 状态更新） |
| `src/routes/contemplate.ts` | 增加 GET 路由，POST 返回 taskId（原 digest.ts） |
| `src/routes/records.ts` | 创建 record 后同步 vectorStore |
| `src/infrastructure/repositories/sqlite-topic.repository.ts` | 增强 `linkRecord` 幂等与单 Record 最多 2 个自动关联约束 |
| `src/server.ts` | 注入 taskRepo + vectorStore 依赖 |
| `src/main.ts` | 初始化 VectorStore + TaskRepository |
| `src/env.ts` | 增加 sqlite-vec + Embedding 环境变量 |
| `.env.example` | 增加 sqlite-vec + Embedding 环境变量 |

### 删除文件

| 文件 | 原因 |
|---|---|
| `src/agent/tools/topic.tools.ts` | 功能合并到 contemplate.tools.ts |

---

## 十、环境变量新增

```env
# Embedding
EMBEDDING_API_KEY=
EMBEDDING_API_BASE=
EMBEDDING_MODEL=text-embedding-v2
EMBEDDING_DIMENSION=1536
```

---

## 十一、实施顺序

1. Task 模块：migration + entity + repository 接口 + SQLite 实现
2. sqlite-vec 集成：加载扩展 + 创建 `vec_topics` / `vec_records`
3. Record 状态流转：更新 entity + migration
4. Contemplate Tools：7 个工具实现
5. Contemplate Prompt：三阶段 prompt 重写
6. Contemplate Service：核心编排逻辑重写
7. 路由更新：contemplate 路由 + records 路由增加向量同步
8. 服务启动：main.ts/server.ts 注入新依赖
9. 索引重建脚本：从 records/topics 主表重建 sqlite-vec 索引
10. 端到端验证：创建 records → 触发 contemplate → 验证 rag_search + plan + execution + record_topics 结果

---

## 十二、sqlite-vec 启动与部署

sqlite-vec 不需要单独启动服务，随后端进程加载。

启动流程：

1. 后端初始化 SQLite 连接。
2. 通过 `sqlite-vec` npm 包加载 sqlite-vec 扩展到同一个 SQLite 实例。
3. 执行 `select vec_version()` 验证扩展可用。
4. 执行数据库迁移，确保 `vec_topics` / `vec_records` 存在。
5. 启动 Hono 后端服务。

本地开发只需要：

```bash
cd apps/backend
pnpm db:migrate
pnpm start
```

持久化位置由 `SQLITE_PATH` 决定，例如默认 `../../data/eiko.sqlite`。`sqlite-vec` 只提供向量表和搜索能力，不单独保存数据。

---

## 十三、并发与降级策略

### 13.1 并发边界

sqlite-vec 的并发能力遵循 SQLite：

- WAL 模式下适合多读少写；
- 同一时刻只有一个写事务；
- Organizer 任务应保持用户级串行或低并发；
- 向量写入失败不应阻塞主业务写入；
- 不建议多实例共享同一个 SQLite 文件。

### 13.2 降级策略

向量索引不可用时，Contemplate 仍可降级到当前逻辑：

1. `rag_search` 返回空结果并记录错误。
2. Prompt 中仍保留 Topics 摘要概览。
3. Agent 基于内联 Records 和最近 Topic 概览继续执行。
4. 后台记录索引异常，后续通过 `scripts/rebuild-vector-index.ts` 重建。
