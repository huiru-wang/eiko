# HTTP 接口与 curl 示例

按当前后端实际注册路由整理，共 14 个业务/健康检查接口。启动方式：在项目根目录运行 `pnpm dev`；代码更新后需重启。真实 Topic 对话前后端均暂缓；已存在的流式路由仅记录现状，不代表对话能力已完成。

## 调用约定

先设置示例变量，后续示例在同一终端执行：

```bash
FANTO_API='http://127.0.0.1:3000'
FANTO_USER_ID='default-user'
TOPIC_ID='替换为查询得到的Topic ID'
TASK_ID='替换为整理任务ID'
```

`--noproxy '*'` 避免本地请求被代理转发；`--fail-with-body` 在 HTTP 错误时仍显示响应体。示例中的 JSON 均直接作为请求体发送，不是文件上传。分页取值和流式请求示例用到 jq。

大部分 JSON 接口返回 `{ "result": ..., "success": true, "errorCode": null, "errorMsg": null }`，失败时检查 HTTP 状态及 success/errorMsg。健康检查与 SSE 不使用这一外壳。当前没有完整认证机制，x-user-id 是开发阶段的用户标识，不能视为身份认证。

## 接口目录

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | /health | 健康检查 |
| POST | /api/records | 单条录入 |
| POST | /api/records/batch | 批量录入 |
| PATCH | /api/records/:id | 修改记录原文并等待重新整理 |
| GET | /api/records | 全部或 Topic 关联记录，支持游标 |
| GET | /api/records/:id | 单条原文、摘要及当前关联话题 |
| GET | /api/topics | Topic 列表 |
| GET | /api/topics/:topicId | Topic 详情 |
| GET | /api/messages | Topic 对话历史 |
| POST | /api/agent/stream | Topic 内流式对话 |
| POST | /api/contemplate | 触发整理 |
| GET | /api/contemplate/tasks | 最近任务列表 |
| GET | /api/contemplate/:id | 任务详情 |
| POST | /api/digest | 整理兼容入口 |

## GET /health

```bash
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/health"
```

返回 `{ "status": "ok", "timestamp": "..." }`，不调用模型或向量服务。

## POST /api/records

content 为必填非空字符串，source 可选，默认 home（首页录入）。x-user-id 可选，默认 default-user。

```bash
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/api/records" \
  -H "x-user-id: $FANTO_USER_ID" -H 'Content-Type: application/json' \
  --data-raw '{"content":"修改复杂接口前，先列出验收样例。","source":"home"}'
```

result 是创建的 Record，包含 id、userId、source、content、status、createdAt、updatedAt；初始状态 pending。原始记录先持久化，向量化异步执行，HTTP 成功不表示向量化已完成。

## POST /api/records/batch

records 为 1–100 项列表，每项包含 content 和可选 source。批量 content 去除首尾空白后不能为空。整批校验并原子写入，向量化异步顺序执行；重复提交会新增记录。

```bash
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/api/records/batch" \
  -H "x-user-id: $FANTO_USER_ID" -H 'Content-Type: application/json' \
  --data-raw '{"records":[
    {"content":"修改前明确验收标准。","source":"home"},
    {"content":"整理后的观点应能回到原始记录。"}
  ]}'
```

result 为 `{ "data": [Record], "count": 2 }`，顺序与请求一致。空批次、超过 100 项、非法 JSON 或无效项返回 400/INVALID_INPUT，不写入记录。

## GET /api/records

| 可选参数 | 说明 |
|---|---|
| topicId | 仅返回该 Topic 关联的记录，限定当前用户；省略则查询用户全部记录 |
| limit | 每页 1–100 条整数，默认 20 |
| cursor | 原样使用上一页 result.nextCursor；第一页省略 |

按 createdAt 倒序、相同时间按 id 倒序；按关联查询不会因重复关联返回重复记录。不存在或不属于当前用户的 Topic 返回空列表。没有状态过滤，全部记录查询可包含 skipped 等状态。

每项追加 topics:[{id,title,status}]，无关联为 []。返回真实关联（含 archived 状态），过滤其他用户的话题，当前页一次批量读取。POST/PATCH 仍返回原有 Record，不含 topics；前端保存后可重新请求读接口。

查询全部记录：

```bash
curl --noproxy '*' --fail-with-body -sS --get "$FANTO_API/api/records" \
  -H "x-user-id: $FANTO_USER_ID" --data-urlencode 'limit=20'
```

查询 Topic 关联记录第一页：

```bash
RECORD_PAGE=$(curl --noproxy '*' --fail-with-body -sS --get "$FANTO_API/api/records" \
  -H "x-user-id: $FANTO_USER_ID" \
  --data-urlencode "topicId=$TOPIC_ID" --data-urlencode 'limit=2')
printf '%s\n' "$RECORD_PAGE" | jq
```

下一页保持相同用户和 topicId，URL 编码游标：

```bash
RECORD_CURSOR=$(printf '%s' "$RECORD_PAGE" | jq -r '.result.nextCursor // empty')
if [ -n "$RECORD_CURSOR" ]; then
  curl --noproxy '*' --fail-with-body -sS --get "$FANTO_API/api/records" \
    -H "x-user-id: $FANTO_USER_ID" --data-urlencode "topicId=$TOPIC_ID" \
    --data-urlencode 'limit=2' --data-urlencode "cursor=$RECORD_CURSOR"
fi
```

result 包含 data、nextCursor、hasMore、pageSize、total。nextCursor 为不透明复合游标，能处理批量创建的同时间记录；结束时为 null，hasMore=false。total 当前固定为 0，是尚未实现的计数占位，不能用来判断总量。非法参数/游标返回 400/INVALID_INPUT。

旧时间字符串游标仍可接受，但只按时间截断，不能保证同时间记录不遗漏；新调用统一使用返回的 nextCursor。

## GET /api/records/:id

```bash
RECORD_ID='替换为记录ID'
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/api/records/$RECORD_ID" \
  -H "x-user-id: $FANTO_USER_ID"
```

result 为完整 Record 加 topics，与列表项一致，包含 content、extData 和当前关联。不存在或其他用户记录返回 404/NOT_FOUND。不从整理任务或历史摘要反推归属。

## PATCH /api/records/:id

仅接受 content，不允许直接修改 status、extData 或其他字段。content 去首尾空白后必须非空。记录不存在或不属于当前用户返回 404；processing 状态返回 409/RECORD_PROCESSING；非法请求返回 400/INVALID_INPUT。

```bash
RECORD_ID='替换为记录ID'
curl --noproxy '*' --fail-with-body -sS -X PATCH "$FANTO_API/api/records/$RECORD_ID" \
  -H "x-user-id: $FANTO_USER_ID" -H 'Content-Type: application/json' \
  --data-raw '{"content":"修正：worktree 用来隔离变更，不能改善模型的指令遵循。"}'
```

成功 result 为更新后的 Record。内容变化时 status=updated、updatedAt 更新、createdAt 保持不变，向量化异步进行。提交相同内容是无变化操作，不改状态或时间、不重新向量化。旧关联及旧 extData.organization 暂时保留，待重新整理成功后更新。

## 整理摘要 extData

数据库使用 ext_data（可空 JSON 文本），Record 和 Topic 查询响应使用 extData（解析后的对象或 null）。仅保存最近一次成功整理摘要，没有事件表、反馈字段或反馈接口。创建和迁移后的历史行默认 null，不伪造过去的整理解释。

Record 示例：

```json
{
  "extData": {
    "organization": {
      "taskId": "...",
      "organizedAt": "2026-09-05T17:00:00.000+08:00",
      "action": "merge_record",
      "reason": "补充接口修改前的验收方法。"
    }
  }
}
```

action 为 merge_record、create_topic 或 skip_record。当前归属以 RecordTopic 为准，不从摘要复制另一套关系。updated/processing 时摘要仍表示上一次成功结果。

Topic 的 extData.organization 为 `{ "taskId": "...", "organizedAt": "...", "summary": "修正了约束遗漏的归因。", "recordIds": ["..."] }`。recordIds 是本批处理后仍关联到该 Topic 的 Record ID，并非该 Topic 的全部历史记录；移出或归档导致该列表可以为空，具体执行可查 taskId。summary 描述本次变化，不是 Topic 的整体 summary。

所有改写成功后，事务统一更新双方 organization、Record 最终状态和 Task 完成状态，保留 extData 其他键。失败不覆盖成功摘要。修改记录重新整理时替换旧关联，原、新 Topic 均用当前有效记录重写；无剩余记录的 Topic 清空正文并归档。执行阶段发生故障会尽量恢复原记录关联，但不提供整个 Topic 内容的事务回滚。

## GET /api/topics

可选 limit（1–100 整数，默认 20）和 cursor，按 updatedAt、id 倒序。使用返回的不透明复合游标，仍兼容旧时间字符串。非法参数返回 400/INVALID_INPUT。

```bash
TOPIC_PAGE=$(curl --noproxy '*' --fail-with-body -sS --get "$FANTO_API/api/topics" \
  -H "x-user-id: $FANTO_USER_ID" --data-urlencode 'limit=20')
printf '%s\n' "$TOPIC_PAGE" | jq
```

```bash
TOPIC_CURSOR=$(printf '%s' "$TOPIC_PAGE" | jq -r '.result.nextCursor // empty')
if [ -n "$TOPIC_CURSOR" ]; then
  curl --noproxy '*' --fail-with-body -sS --get "$FANTO_API/api/topics" \
    -H "x-user-id: $FANTO_USER_ID" --data-urlencode 'limit=20' \
    --data-urlencode "cursor=$TOPIC_CURSOR"
fi
```

result 为 data、nextCursor、hasMore、total、pageSize。total 固定为 0，不代表总数；多取一条计算 hasMore，末页 nextCursor=null。仅返回 active Topic。新游标解决同时间翻页遗漏，但分页期间话题更新仍会改变排序，不提供冻结快照。

## GET /api/topics/:topicId

```bash
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/api/topics/$TOPIC_ID" \
  -H "x-user-id: $FANTO_USER_ID"
```

result 是 Topic，包括 id、sessionId、title、summary、content、tags、status、extData 等；不存在或不属于当前用户返回 404/NOT_FOUND。允许读取自己的 archived 话题。响应不含 relatedRecords，关联记录使用 GET /api/records?topicId=...。

## GET /api/messages

topicId 必填，按消息 timestamp 升序返回全部历史，目前无游标。

```bash
curl --noproxy '*' --fail-with-body -sS --get "$FANTO_API/api/messages" \
  -H "x-user-id: $FANTO_USER_ID" --data-urlencode "topicId=$TOPIC_ID"
```

result 是原始事件 Message 数组；缺少 topicId 返回 400/MISSING_PARAM，Topic 不存在或不属于当前用户返回 404。查询限定当前用户及 Topic 当前 sessionId，按 timestamp、id 升序。role 为事件类型，payload 为事件 JSON 字符串，不是已渲染的聊天消息；真实对话能力暂缓。

## POST /api/agent/stream

JSON 中 sessionId、topicId、userId、message 均必填。使用 Topic 详情返回的 sessionId，不能使用整理任务 ID。此接口使用请求体 userId，不能仅靠 x-user-id。

```bash
TOPIC_SESSION_ID=$(curl --noproxy '*' --fail-with-body -sS \
  "$FANTO_API/api/topics/$TOPIC_ID" | jq -r '.result.sessionId')
AGENT_BODY=$(jq -n --arg sessionId "$TOPIC_SESSION_ID" --arg topicId "$TOPIC_ID" \
  --arg userId "$FANTO_USER_ID" --arg message '帮我梳理这个话题中尚未解决的问题。' \
  '{sessionId:$sessionId,topicId:$topicId,userId:$userId,message:$message}')
curl --noproxy '*' --fail-with-body -sS -N "$FANTO_API/api/agent/stream" \
  -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
  --data-raw "$AGENT_BODY"
```

返回 SSE，event 为 Agent 事件类型，data 为事件 JSON；正常结束为 `event: done`、`data: [DONE]`。流内失败为 `event: error`，须检查事件，不能只判断 HTTP 状态。缺参数在流开始前返回 400/MISSING_PARAM。

## POST /api/contemplate

同步等待整理完成；处理当前用户 pending、updated、skipped 记录，一次最多 30 条。JSON 的 userId 优先于请求头，默认 default-user。

```bash
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/api/contemplate" \
  -H "x-user-id: $FANTO_USER_ID" -H 'Content-Type: application/json' \
  --data-raw '{}'
```

返回 result.taskId、pendingCount（本批领取数量）、topicCount、summary、eventCount。当前 topicCount 是候选 Topic 数量，不是最终总数；最终效果应查询 Topics 和任务详情。没有待处理记录时 taskId=null。失败返回 500/CONTEMPLATE_FAILED。

## GET /api/contemplate/tasks

可选 limit，默认 20，按任务 updatedAt 倒序，无游标。当前仓库查询按用户返回任务，不额外过滤任务类型。

```bash
curl --noproxy '*' --fail-with-body -sS --get "$FANTO_API/api/contemplate/tasks" \
  -H "x-user-id: $FANTO_USER_ID" --data-urlencode 'limit=20'
```

result 为 Task 数组，包含 id、type、status、input、result、error、createdAt、updatedAt。

## GET /api/contemplate/:id

```bash
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/api/contemplate/$TASK_ID" \
  -H "x-user-id: $FANTO_USER_ID"
```

不存在或用户不匹配返回 404/NOT_FOUND。成功时 result 是 Task；result.result 中可检查 workflowVersion、planningAttempts、plan、validation、execution、rewrites、skipped。planningAttempts 保存每次规划完整输出和诊断。

## POST /api/digest

兼容入口，运行与 /api/contemplate 相同的工作流，选择其中一个触发即可。

```bash
curl --noproxy '*' --fail-with-body -sS "$FANTO_API/api/digest" \
  -H "x-user-id: $FANTO_USER_ID" -H 'Content-Type: application/json' \
  --data-raw '{}'
```

请求、成功响应与 /api/contemplate 相同，失败错误码为 DIGEST_FAILED。
