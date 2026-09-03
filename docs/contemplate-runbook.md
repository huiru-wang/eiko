# Contemplate 启动与链路测试手册

本文档用于本地启动后端、验证 Record 沉思整理链路，并通过日志快速定位任务失败原因。

## 1. 环境变量

后端环境文件：`apps/backend/.env`

最小配置：

```env
# LLM Provider
PROVIDER=deepseek
MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=

# Database
SQLITE_PATH=../../data/eiko.sqlite

# Embedding
EMBEDDING_API_KEY=
EMBEDDING_API_BASE=
EMBEDDING_MODEL=text-embedding-v2
EMBEDDING_DIMENSION=1536

# Server
PORT=3000
HOST=0.0.0.0

# Scheduler
ORGANIZER_TRIGGER_CRON=*/5 * * * *
```

说明：

- `SQLITE_PATH` 是业务数据和向量索引的持久化位置。
- `sqlite-vec` 通过 npm 包加载，不需要配置扩展路径。
- `vec_topics` 和 `vec_records` 会写入同一个 SQLite 文件。
- 如果未配置 `EMBEDDING_API_KEY`，主业务仍可运行，但 `rag_search` 会返回空结果并走最近 Topic 概览降级。

## 2. 启动

在项目根目录执行：

```bash
cd /Users/wanghuiru/Workspace/side-project/eiko
pnpm install
pnpm --filter @eiko/backend db:migrate
pnpm --filter @eiko/backend start
```

正常启动日志应包含：

```text
[database] sqlite-vec loaded: v0.1.9
[main] Migrations completed
[main] Server listening on http://0.0.0.0:3000
```

## 3. 完整链路测试

另开一个终端执行以下请求。

### 3.1 健康检查

```bash
curl http://127.0.0.1:3000/health
```

期望返回：

```json
{"status":"ok"}
```

实际响应会额外包含 `timestamp`。

### 3.2 创建第一条 Record

```bash
curl -X POST http://127.0.0.1:3000/api/records \
  -H 'content-type: application/json' \
  -H 'x-user-id: default-user' \
  -d '{"content":"我最近在想，做碎片记录工具时，最重要的不是分类，而是让用户不用整理也能持续沉淀出长期话题。"}'
```

期望：

- `success=true`
- `result.status=pending`
- 服务端日志出现 `[records] record created`
- 如果 embedding 可用，随后出现 `[vector-store] upsert record completed`

### 3.3 创建第二条相关 Record

```bash
curl -X POST http://127.0.0.1:3000/api/records \
  -H 'content-type: application/json' \
  -H 'x-user-id: default-user' \
  -d '{"content":"今天又想到一点：AI 整理记录时应该保守合并，错误合并比暂时不合并更糟。"}'
```

期望同上。

### 3.4 触发 Contemplate 整理任务

```bash
curl -X POST http://127.0.0.1:3000/api/contemplate \
  -H 'content-type: application/json' \
  -H 'x-user-id: default-user' \
  -d '{}'
```

期望返回：

```json
{
  "success": true,
  "result": {
    "taskId": "...",
    "pendingCount": 2,
    "topicCount": 0,
    "summary": "..."
  }
}
```

记录返回的 `taskId`，用于后续查询任务详情。

### 3.5 查询任务详情

```bash
curl http://127.0.0.1:3000/api/contemplate/{taskId} \
  -H 'x-user-id: default-user'
```

期望：

```json
{
  "success": true,
  "result": {
    "id": "...",
    "status": "completed",
    "result": {
      "plan": {},
      "execution": {},
      "verification": {}
    }
  }
}
```

如果失败，查看：

- `result.status=failed`
- `result.error`
- 服务端日志中的同一 `taskId`

### 3.6 查询 Topics

```bash
curl http://127.0.0.1:3000/api/topics \
  -H 'x-user-id: default-user'
```

期望至少出现一个由 Contemplate 创建或更新的 Topic。

### 3.7 查询 Records

```bash
curl http://127.0.0.1:3000/api/records \
  -H 'x-user-id: default-user'
```

期望：

- 已整理进 Topic 的 Record 状态为 `organized`
- 信息量不足且本轮跳过的 Record 状态为 `skipped`
- 任务失败时，被领取的 Record 会从 `processing` 恢复到进入任务前的状态

## 4. 日志观测

所有新增日志格式：

```text
[ISO_TIME] [level] [scope] message {"key":"value"}
```

常用过滤：

```bash
pnpm --filter @eiko/backend start | rg 'contemplate|contemplate-tool|vector-store|records'
```

### 4.1 Record 创建

```text
[records] record created
[vector-store] upsert record start
[vector-store] upsert record completed
```

如果向量化失败：

```text
[records] upsert record vector failed
[vector-store] embedding request failed
[vector-store] embedding dimension mismatch or empty embedding
```

### 4.2 Contemplate 主流程

```text
[contemplate] claim records start
[contemplate] task created and records claimed
[contemplate] fallback topics loaded
[contemplate] task status updated
[contemplate] agent prompt start
[contemplate] agent idle
[contemplate] records marked organized
[contemplate] records marked skipped
[contemplate] task completed
```

### 4.3 Agent 工具调用

```text
[contemplate-tool] rag_search start
[contemplate-tool] rag_search completed
[contemplate-tool] get_topic
[contemplate-tool] get_record
[contemplate-tool] create_topic start
[contemplate-tool] create_topic completed
[contemplate-tool] update_topic start
[contemplate-tool] update_topic completed
[contemplate-tool] link_record_topic start
[contemplate-tool] link_record_topic completed
[contemplate-tool] update_task start
[contemplate-tool] update_task completed
```

### 4.4 失败恢复

```text
[contemplate] task failed
[contemplate] processing records restored
[contemplate] restore processing records failed
```

排查顺序：

1. 用 `taskId` 查询 `/api/contemplate/{taskId}`，查看 `status` 和 `error`。
2. 在服务端日志中搜索同一个 `taskId`。
3. 如果停在 `claim records start` 后，检查数据库写入和 Record 状态。
4. 如果停在 `rag_search`，检查 `EMBEDDING_*` 配置和 sqlite-vec 加载日志。
5. 如果停在 `create_topic` 或 `update_topic`，检查 Topic 写入和 Agent 输出参数。
6. 如果停在 `link_record_topic`，检查 Record/Topic 是否同属一个 `userId`，以及单 Record 是否已关联 2 个 Topic。
7. 如果任务失败后 Record 仍是 `processing`，检查 `processing records restored` 是否执行。

## 5. 向量索引重建

首次接入、embedding 模型变更或怀疑索引不一致时执行：

```bash
cd /Users/wanghuiru/Workspace/side-project/eiko
pnpm vector:rebuild
```

期望日志：

```text
[vector] rebuilt index: records=..., topics=...
```

## 6. 验证命令

代码层验证：

```bash
pnpm --filter @eiko/backend typecheck
```

数据库迁移验证：

```bash
pnpm --filter @eiko/backend db:migrate
```
