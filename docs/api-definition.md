# Eiko HTTP API 接口定义

> 所有接口以 `/api` 为前缀。  
> 请求和响应均使用 JSON 格式。  
> 需要鉴权的接口通过 `Authorization: Bearer <token>` 传递用户身份。

---

## 1. 通用约定

### 1.1 统一响应

除流式接口外，所有接口统一使用以下响应结构：

```json
{
  "result": "<T>",
  "success": true,
  "errorCode": null,
  "errorMsg": null
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| result | T \| null | 业务数据，具体类型由各接口定义 |
| success | boolean | `true` 表示成功，`false` 表示失败 |
| errorCode | string \| null | 失败时的错误码 |
| errorMsg | string \| null | 失败时的错误描述 |

> 后续各接口的「响应 result」均指 `result` 字段的类型，外层统一包装不再重复展示。

### 1.2 错误响应

```json
{
  "result": null,
  "success": false,
  "errorCode": "ERROR_CODE",
  "errorMsg": "人类可读的错误描述"
}
```

常见错误码：

| HTTP 状态码 | errorCode | 说明 |
|---|---|---|
| 400 | `INVALID_PARAMS` | 请求参数不合法 |
| 401 | `UNAUTHORIZED` | 未登录或 token 失效 |
| 403 | `FORBIDDEN` | 无权访问该资源 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 状态冲突，如重复操作 |
| 500 | `INTERNAL_ERROR` | 服务端未知错误 |

### 1.3 分页

列表接口统一使用游标分页。

请求参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| cursor | string | 否 | 上一页返回的 nextCursor 值，首页不传 |
| pageSize | number | 否 | 每页数量，默认 20，上限 50 |

响应结构：

```json
{
  "result": {
    "data": [],
    "nextCursor": null,
    "hasMore": false,
    "total": 0,
    "pageSize": 20
  },
  "success": true,
  "errorCode": null,
  "errorMsg": null
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| data | Array | 当前页数据列表 |
| nextCursor | string \| null | 下一页游标，为 null 表示没有更多数据 |
| hasMore | boolean | 是否还有下一页 |
| total | number | 总记录数 |
| pageSize | number | 当前页大小 |

---

## 2. Record 记录

### 2.1 创建 Record

用户从 Inbox 提交文字后创建。

- **Method:** `POST`
- **Path:** `/api/records`
- **Content-Type:** `application/json`

**请求：**

```json
{
  "content": "今天和产品聊了一下用户留存的问题"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| content | string | 是 | 文字内容 |

**响应 result：**

```json
{
  "id": "rec_20260903_001",
  "content": "今天和产品聊了一下用户留存的问题",
  "status": "pending",
  "occurredAt": "2026-09-03T10:30:00.000Z",
  "createdAt": "2026-09-03T10:30:00.000Z"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | Record ID |
| content | string | 原文 |
| status | string | 状态：`"pending"` / `"processing"` / `"digested"` |
| occurredAt | string | 发生时间（ISO 8601） |
| createdAt | string | 创建时间（ISO 8601） |

**说明：**

- 创建后 `status` 固定为 `"pending"`，后台异步消化。
- `content` 为用户原文。

### 2.2 获取 Record 列表（Timeline）

按发生时间倒序返回用户的 Record 列表。

- **Method:** `GET`
- **Path:** `/api/records`

**请求参数（Query）：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| cursor | string | 否 | 分页游标 |
| pageSize | number | 否 | 每页数量，默认 20 |

**响应 result：**

```json
{
  "data": [
    {
      "id": "rec_20260903_001",
      "content": "今天和产品聊了一下用户留存的问题",
      "status": "digested",
      "topics": [
        {
          "id": "tp_001",
          "title": "用户留存策略"
        }
      ],
      "occurredAt": "2026-09-03T10:30:00.000Z"
    }
  ],
  "nextCursor": null,
  "hasMore": false,
  "total": 1,
  "pageSize": 20
}
```

RecordView 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | Record ID |
| content | string | 原文 |
| status | string | `"pending"` / `"processing"` / `"digested"` |
| topics | Array | 关联的 Topic 简要（id + title） |
| occurredAt | string | 发生时间（ISO 8601） |

**说明：**

- `topics` 只返回简要信息（id + title），用于 Record 行展示关联标签。

---

## 3. Topic 话题

### 3.1 获取 Topic 列表

返回用户所有活跃话题，按更新时间倒序。

- **Method:** `GET`
- **Path:** `/api/topics`

**请求参数（Query）：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| cursor | string | 否 | 分页游标 |
| pageSize | number | 否 | 每页数量，默认 20 |

**响应 result：**

```json
{
  "data": [
    {
      "id": "tp_001",
      "title": "用户留存策略",
      "summary": "关于如何提升次日留存率的初步思考",
      "updatedAt": "2026-09-03T14:00:00.000Z",
      "hasNewContent": false
    }
  ],
  "nextCursor": null,
  "hasMore": false,
  "total": 1,
  "pageSize": 20
}
```

TopicListItem 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | Topic ID |
| title | string | 话题标题 |
| summary | string | 当前摘要或直接结论 |
| updatedAt | string | 更新时间（ISO 8601） |
| hasNewContent | boolean | 是否有用户未查看的新内容 |

**说明：**

- `hasNewContent` 用于展示低压力圆点标识，表示 Topic 在用户上次查看后有更新。
- 仅返回 `status = 'active'` 的话题。

### 3.2 获取 Topic 详情

返回 Topic 完整正文和关联记录。

- **Method:** `GET`
- **Path:** `/api/topics/:topicId`

**路径参数：**

| 参数 | 类型 | 说明 |
|---|---|---|
| topicId | string | Topic ID |

**响应 result：**

```json
{
  "topic": {
    "id": "tp_001",
    "title": "用户留存策略",
    "summary": "关于如何提升次日留存率的初步思考",
    "bodyMarkdown": "## 核心问题\n\n次日留存率持续低于 30%...",
    "sessionId": "sess_tp001_01",
    "needsOrganize": false,
    "updatedAt": "2026-09-03T14:00:00.000Z"
  },
  "relatedRecords": [
    {
      "id": "rec_20260903_001",
      "content": "今天和产品聊了一下用户留存的问题",
      "occurredAt": "2026-09-03T10:30:00.000Z"
    }
  ]
}
```

TopicView 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | Topic ID |
| title | string | 话题标题 |
| summary | string | 当前摘要 |
| bodyMarkdown | string | 完整 Markdown 正文 |
| sessionId | string | 对话使用的 Session ID |
| needsOrganize | boolean | 是否正在等待后台整理 |
| updatedAt | string | 更新时间（ISO 8601） |

RelatedRecordView 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | Record ID |
| content | string | 原始内容 |
| occurredAt | string | 发生时间（ISO 8601） |

**说明：**

- `relatedRecords` 为与该 Topic 关联的所有 Record 简要视图。
- `sessionId` 供后续对话接口使用。
- 接口调用后，该 Topic 的 `hasNewContent` 标记应被清除。

---

## 4. Agent 对话

### 4.1 Topic 对话（流式）

用户围绕某个 Topic 发送消息，后端以 SSE 流式返回 Agent 响应。

- **Method:** `POST`
- **Path:** `/api/agent/stream`
- **Content-Type:** `application/json`
- **Accept:** `application/x-ndjson`

**请求：**

```json
{
  "topicId": "tp_001",
  "sessionId": "sess_tp001_01",
  "content": "你觉得次日留存的关键指标应该是什么？"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| topicId | string | 是 | 话题 ID |
| sessionId | string | 是 | 从 Topic 详情获取的 Session ID |
| content | string | 是 | 用户发送的文字内容 |

**响应：**

HTTP 200，`Content-Type: application/x-ndjson`，使用 Chunked Transfer Encoding。

每一行是一个独立的 JSON 对象，对应以下事件之一：

```json
{"type": "message_start", "role": "assistant"}
```
```json
{"type": "text_delta", "text": "关于次日留存，"}
```
```json
{"type": "tool_start", "name": "search_records"}
```
```json
{"type": "tool_end", "name": "search_records", "isError": false}
```
```json
{"type": "message_end"}
```
```json
{"type": "topic_update", "topicId": "tp_001", "needsOrganize": true}
```
```json
{"type": "error", "message": "模型调用超时"}
```

事件类型：

| type | 字段 | 说明 |
|---|---|---|
| `message_start` | role | 一条新消息开始，role 固定为 `"assistant"` |
| `text_delta` | text | 文本增量片段 |
| `tool_start` | name | 工具调用开始 |
| `tool_end` | name, isError | 工具调用结束 |
| `message_end` | — | 一条消息结束 |
| `topic_update` | topicId, needsOrganize | Topic 状态变化通知（可选） |
| `error` | message | 流级别错误 |

**典型流序列：**

```
{"type":"message_start","role":"assistant"}
{"type":"text_delta","text":"关于你提到的"}
{"type":"text_delta","text":"这个问题，"}
{"type":"text_delta","text":"我觉得..."}
{"type":"message_end"}
{"type":"topic_update","topicId":"tp_001","needsOrganize":true}
```

**说明：**

- 用户消息（`user` Message）在流开始前持久化，流结束后前端刷新消息列表。
- `topic_update` 事件是可选的，仅当本轮对话产生 `TopicAction` 时发送。
- 前端 `Agent Stream Client` 负责将 Chunk 解码为上述事件。
- 客户端可随时中断 HTTP 连接以取消流式输出。

**错误场景：**

| 场景 | 处理 |
|---|---|
| topicId 不存在 | HTTP 404 直接返回（不进入流） |
| 模型调用失败 | 流中发送 `error` 事件后关闭连接 |
| sessionId 不匹配 | HTTP 400 直接返回 |

### 4.2 获取消息历史

返回某个 Topic/Session 下的历史消息列表，用于恢复对话上下文。

- **Method:** `GET`
- **Path:** `/api/messages`

**请求参数（Query）：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| topicId | string | 是 | 话题 ID |
| sessionId | string | 是 | Session ID |
| before | number | 否 | 返回此消息 ID 之前的消息（用于向上翻页） |
| limit | number | 否 | 每页数量，默认 30，上限 100 |

**响应 result：**

```json
{
  "items": [
    {
      "id": 1,
      "role": "user",
      "content": {
        "role": "user",
        "content": "你觉得次日留存的关键指标应该是什么？",
        "timestamp": 1725350400000
      },
      "timestamp": 1725350400000
    },
    {
      "id": 2,
      "role": "assistant",
      "content": {
        "role": "assistant",
        "content": "关于次日留存，我认为...",
        "timestamp": 1725350403000
      },
      "timestamp": 1725350403000
    }
  ],
  "hasMore": false
}
```

MessageView 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | number | 自增 ID，用于分页游标 |
| role | string | `"user"` / `"assistant"` / `"toolResult"` |
| content | object | 从 Pi payload 中提取的消息内容，结构取决于 role |
| timestamp | number | Pi 原始时间戳（毫秒） |

**说明：**

- `content` 的结构取决于 Pi Agent 的消息格式，前端需要按 role 分别处理渲染。
- `user` 消息：包含用户发送的文本。
- `assistant` 消息：包含 AI 回复文本，可能包含 tool calls。
- `toolResult` 消息：包含工具执行结果。
- 消息按 timestamp 正序返回（最早的在前）。

---

## 5. 接口总览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/records` | 是 | 创建一条 Record |
| GET | `/api/records` | 是 | 获取 Record 列表（Timeline） |
| GET | `/api/topics` | 是 | 获取 Topic 列表 |
| GET | `/api/topics/:topicId` | 是 | 获取 Topic 详情、关联记录 |
| POST | `/api/agent/stream` | 是 | Topic 对话，SSE 流式响应 |
| GET | `/api/messages` | 是 | 获取 Topic 下的消息历史 |

---

## 7. 接口调用链路示例

### 5.1 首页文字捕获 → Timeline

```
1. POST /api/records           → 创建 Record，立即展示在 Timeline
2. GET  /api/records           → 刷新 Timeline（status 可能已更新）
```

### 5.2 查看 Topic 列表 → 详情 → 对话

```
1. GET  /api/topics                     → 展示话题列表
2. GET  /api/topics/:topicId            → 展示话题详情 + 关联记录
3. GET  /api/messages?topicId&sessionId → 恢复历史消息
4. POST /api/agent/stream               → 发送消息，接收流式 AI 回复
5. GET  /api/messages?topicId&sessionId → 流结束后刷新消息列表
6. GET  /api/topics/:topicId            → 可选：刷新 Topic 状态
```
