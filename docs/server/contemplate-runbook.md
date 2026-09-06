# Contemplate v2 Simple 测试流程

当前版本为 v2.2，新增双方 extData.organization 和 Record 修改后重整，见 [HTTP 文档](../api/http-api.md)。原 v2.1 的修正机制与错误码继续适用。首次规划校验失败可修正一次，第二次失败恢复记录状态并返回 HTTP 500。

本文档用于完整验证新版整理链路：

```text
Claim → Load Context → Plan → Validate → Execute → Rewrite → Finalize
```

测试数据：

- `test/records-test-data.json`
- `test/expected-topics.json`

核心验收目标：

> 6 条 Record 应收敛为 2 个长期 Topic，而不是每条 Record 生成一个 Topic。

## 1. 准备

建议使用独立测试数据库，避免污染本地开发数据。

```bash
cd /Users/wanghuiru/Workspace/side-project/fanto
export SQLITE_PATH=/private/tmp/fanto-contemplate-test.sqlite
pnpm install
pnpm db:migrate
```

确保 `apps/server/.env` 中已配置可用模型：

```env
PROVIDER=deepseek
MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=...
```

如果要验证向量召回，还需要配置 embedding：

```env
EMBEDDING_API_KEY=...
EMBEDDING_API_BASE=...
EMBEDDING_MODEL=text-embedding-v2
EMBEDDING_DIMENSION=1536
```

没有 embedding 时，主流程仍可运行，会降级使用最近 active Topics。

## 2. 启动服务并观察日志

```bash
SQLITE_PATH=/private/tmp/fanto-contemplate-test.sqlite pnpm dev
```

建议过滤关键日志：

```bash
SQLITE_PATH=/private/tmp/fanto-contemplate-test.sqlite pnpm dev | rg 'contemplate-v2|vector-store|records|database|main'
```

启动期望日志：

```text
[database] sqlite-vec loaded: v0.1.9
[main] Database initialized: /private/tmp/fanto-contemplate-test.sqlite
[main] Migrations completed
[main] Server listening on http://0.0.0.0:3000
```

健康检查：

```bash
curl -sS http://127.0.0.1:3000/health
```

期望：

```json
{"status":"ok","timestamp":"2026-09-05T...+08:00"}
```

## 3. 导入测试 Records

测试数据位于：

```text
test/records-test-data.json
```

每条数据包含：

- `caseId`：人工验收用例编号，不会写入当前 API；
- `content`：提交到 `/api/records` 的原始文本。

使用 Node 批量导入：

```bash
node - <<'NODE'
const fs = require('node:fs');
const records = JSON.parse(fs.readFileSync('test/records-test-data.json', 'utf8'));

(async () => {
  for (const record of records) {
    const res = await fetch('http://127.0.0.1:3000/api/records', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'default-user'
      },
      body: JSON.stringify({ content: record.content, source: 'home' })
    });
    const body = await res.json();
    console.log(record.caseId, body.success, body.result?.id, body.result?.status);
  }
})();
NODE
```

期望输出：

```text
ai-agent-001 true <record-id> pending
ai-agent-002 true <record-id> pending
ai-agent-003 true <record-id> pending
ai-agent-004 true <record-id> pending
fanto-product-001 true <record-id> pending
fanto-product-002 true <record-id> pending
```

服务端期望日志：

```text
[records] record created {"recordId":"...","userId":"default-user","contentLength":...}
```

如果 embedding 可用，还应看到：

```text
[vector-store] upsert record start {"recordId":"...","userId":"default-user","contentLength":...}
[vector-store] upsert record completed {"recordId":"...","userId":"default-user"}
```

如果 embedding 不可用，允许出现：

```text
[vector-store] disabled because embedding api key is missing
```

## 4. 触发 Contemplate

```bash
curl -sS -X POST http://127.0.0.1:3000/api/contemplate \
  -H 'content-type: application/json' \
  -H 'x-user-id: default-user' \
  -d '{}'
```

成功期望：

```json
{
  "success": true,
  "result": {
    "taskId": "<task-id>",
    "pendingCount": 6,
    "topicCount": 0,
    "summary": "沉思整理任务已完成",
    "eventCount": 0
  }
}
```

记录返回的 `taskId`。

## 5. 日志期望

完整成功链路应出现以下日志，`taskId` 应保持一致。

### 5.1 Claim

```text
[contemplate-v2] claim start {"userId":"default-user","statuses":["pending","updated","skipped"],"limit":30}
[contemplate-v2] records claimed {"taskId":"<task-id>","userId":"default-user","recordIds":["..."],"recordCount":6}
```

### 5.2 Context

```text
[contemplate-v2] context loaded {"taskId":"<task-id>","recordCount":6,"candidateTopicCount":0}
```

如果已有 Topic 或向量召回可用，`candidateTopicCount` 可以大于 0。

如果向量查询失败但任务继续：

```text
[contemplate-v2] vector topic search failed; fallback to recent topics {"taskId":"<task-id>","recordId":"...","error":"..."}
```

### 5.3 Plan

```text
[contemplate-v2] plan prompt start {"taskId":"<task-id>"}
[contemplate-v2] llm json step start {"taskId":"<task-id>","step":"plan","promptLength":...}
[contemplate-v2] llm json step completed {"taskId":"<task-id>","step":"plan"}
[contemplate-v2] plan generated {"taskId":"<task-id>","actionCount":...}
```

动作统计使用 info 日志，新建多个 Topic 本身不代表异常：

```text
[contemplate-v2] plan action counts {"taskId":"<task-id>","createCount":2,"mergeRecordCount":0,"mergeTopicCount":0,"skipCount":0}
```

归属是否正确需要结合计划和原始记录判断，数量不是唯一标准。

### 5.4 Validate

```text
[contemplate-v2] plan validation passed {"taskId":"<task-id>"}
```

首次校验失败会修正一次：

```text
[contemplate-v2] llm json step failed {"taskId":"<task-id>","step":"plan","attempt":1,"errorCode":"ACTION_SCHEMA_ERROR","failedActions":[...]}
[contemplate-v2] plan correction scheduled {"taskId":"<task-id>","attempt":2}
```

第二次仍失败时返回 HTTP 500、success=false，执行器不会运行：

```text
[contemplate-v2] task failed {"taskId":"<task-id>","error":"..."}
[contemplate-v2] records restored {"taskId":"<task-id>","records":[...]}
```

### 5.5 Execute

每个 action 应出现一条：

```text
[contemplate-v2] action executed {"taskId":"<task-id>","actionId":"action-1","type":"create_topic","topicId":"..."}
[contemplate-v2] action executed {"taskId":"<task-id>","actionId":"action-2","type":"merge_record"}
[contemplate-v2] action executed {"taskId":"<task-id>","actionId":"action-3","type":"skip_record"}
```

当前测试数据理想情况下应出现：

- 2 个 `create_topic`；或
- 1 个 `create_topic` 加若干 `merge_record`；如果测试库已有旧 Topic，也可能出现 `merge_topic`。

不理想但可观察的问题：

```text
create_topic action 数量接近 Record 数量
```

这表示 Prompt 仍没有压住 Topic 爆炸。

### 5.6 Rewrite

每个受影响 Topic 应出现：

```text
[contemplate-v2] rewrite prompt start {"taskId":"<task-id>","topicId":"...","actionCount":...,"newRecordCount":...,"relatedRecordCount":...}
[contemplate-v2] llm json step start {"taskId":"<task-id>","step":"rewrite:<topic-id>","promptLength":...}
[contemplate-v2] llm json step completed {"taskId":"<task-id>","step":"rewrite:<topic-id>"}
[contemplate-v2] topic rewritten {"taskId":"<task-id>","topicId":"...","contentLength":...}
```

如果 embedding 可用，还应看到：

```text
[vector-store] upsert topic start {"topicId":"...","userId":"default-user","embeddingTextLength":...}
[vector-store] upsert topic completed {"topicId":"...","userId":"default-user"}
```

### 5.7 Finalize

```text
[contemplate-v2] records finalized {"taskId":"<task-id>","organizedCount":6,"skippedCount":0}
[contemplate-v2] task completed {"taskId":"<task-id>","workflowVersion":"contemplate-workflow-v2.2-simple"}
```

## 6. 查看 Task Result

```bash
curl -sS http://127.0.0.1:3000/api/contemplate/<task-id> \
  -H 'x-user-id: default-user'
```

重点检查：

```text
result.result.workflowVersion = contemplate-workflow-v2.2-simple
result.result.plan.actions
result.result.validation.passed = true
result.result.execution.actions
result.result.rewrites
result.result.skipped
```

Plan 期望：

- 每条 Record 被覆盖；
- 不应出现 6 个 `create_topic`；
- action reason 应说明长期关切或 Facet，不应只是“语义相关”；
- 如果已有过细 Topic，应出现 `merge_topic`。

## 7. 验收 Topics

查询 active Topics：

```bash
curl -sS http://127.0.0.1:3000/api/topics \
  -H 'x-user-id: default-user'
```

期望参见：

```text
test/expected-topics.json
```

核心期望：

```text
active Topic 数量：2 个左右
```

理想 Topic A：

```text
AI Native 工程师的能力与 Agent 协作实践
```

应覆盖：

- `ai-agent-001`
- `ai-agent-002`
- `ai-agent-003`
- `ai-agent-004`

正文应包含这些 Facet：

- AI Coding 中理解不等于严格执行的执行偏差；
- 执行前多轮澄清、上下文完整和根因确认；
- 用 Mermaid 等可视化方式约束技术方案；
- 用 git worktree 隔离迭代变化并保障回滚；
- 工程师能力从写代码转向定义问题、设计工作流和驾驭 AI 协同决策。

理想 Topic B：

```text
Fanto 的碎片沉淀机制
```

应覆盖：

- `fanto-product-001`
- `fanto-product-002`

正文应包含这些 Facet：

- 产品重点不是分类，而是降低整理负担；
- 用户只负责表达，系统负责让长期话题自然浮现；
- 错误合并比暂时不合并更糟；
- 过早新建 Topic 会导致知识系统碎片化。

## 8. 验收 RecordTopic

查看关联关系：

```bash
sqlite3 /private/tmp/fanto-contemplate-test.sqlite \
  "select r.content, t.title, rt.relation from record_topics rt join records r on r.id = rt.record_id join topics t on t.id = rt.topic_id order by r.created_at;"
```

期望：

- 6 条 Record 都有关联 Topic；
- 前 4 条 AI/Agent/工程能力相关 Record 关联到同一个 Topic；
- 后 2 条 Fanto 产品机制相关 Record 关联到同一个 Topic；
- 每条 Record 自动关联不超过 2 个 Topic。

## 9. 验收 Record 状态

```bash
sqlite3 /private/tmp/fanto-contemplate-test.sqlite \
  "select status, count(*) from records group by status;"
```

理想期望：

```text
organized|6
```

如果出现：

```text
processing|N
```

说明任务中断或失败恢复不完整，需要查看同一 `taskId` 的失败日志。

如果出现：

```text
skipped|N
```

不一定是错误，但当前 6 条测试数据都应有沉淀价值，通常不应被 skipped。

## 10. 失败排查

### 10.1 模型没有返回合法 JSON

日志：

```text
[contemplate-v2] llm json step failed {"taskId":"...","step":"plan","attempt":1,"errorCode":"JSON_PARSE_ERROR","error":"..."}
```

处理：

- 检查模型是否遵守“只输出 JSON”；
- 缩短输入 Topic content；
- 强化 prompt 中的 JSON 输出约束。

### 10.2 Plan 校验失败

日志：

```text
[contemplate-v2] llm json step failed {"taskId":"...","step":"plan","errorCode":"PLAN_VALIDATION_ERROR","violations":[...]}
```

常见原因：

- LLM 编造了 recordId/topicId；
- 某条 Record 没有被 action 覆盖；
- 同一条 Record 同时被多个 action 覆盖；
- `merge_topic` 把 targetTopicId 放进了 sourceTopicIds；
- `create_topic` 缺少 boundary。

### 10.3 Topic 仍然爆炸

现象：

- 结合 `plan action counts` 观察新增数量；
- active Topics 接近 Record 数量；
- Topic 标题贴着单条观点。

处理方向：

- 继续收紧 Plan Prompt；
- 增加独立 Extract Points；
- 增加 Boundary Review；
- 增加 Plan Revise。

### 10.4 重写内容过度扩写

现象：

- content 很长但信息增量少；
- 用户假设被写成事实；
- 按 Record 顺序堆叠。

处理方向：

- 收紧 Rewrite Prompt；
- 要求按 Facet 输出；
- 要求明确“用户判断 / Fanto 理解 / 待验证问题”。

## 11. 重跑测试

重建测试库最干净：

```bash
rm -f /private/tmp/fanto-contemplate-test.sqlite /private/tmp/fanto-contemplate-test.sqlite-shm /private/tmp/fanto-contemplate-test.sqlite-wal
export SQLITE_PATH=/private/tmp/fanto-contemplate-test.sqlite
pnpm db:migrate
```

也可以只把 Records 改回待处理：

```bash
sqlite3 /private/tmp/fanto-contemplate-test.sqlite \
  "update records set status='updated';"
```

如果要完整重跑整理质量，推荐直接重建测试库。
