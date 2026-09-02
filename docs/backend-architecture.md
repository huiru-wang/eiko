# AI 碎片思考助手：后端技术架构

> MVP 载体：微信小程序  
> 架构形态：Fastify 模块化单体 + 内嵌 Agent Runtime  
> 日期：2026-09-02

## 1. 方案定稿

后端采用以下结构：

- HTTP Server 和 Agent Runtime 在同一个 Node.js 进程中。
- Agent 每次执行时根据 `userId + sessionId` 构造 Context，并临时 `new Agent(context)`。
- SQLite 保存 Record、Topic、Message 和 Attachment。
- 后台触发器直接扫描：
  - 新增或尚未消化的 Record；
  - 带有 Pending Actions、需要重新整理的 Topic。
- Topic 正文使用 Markdown。
- 文件存储使用阿里云 OSS；业务层保留 Attachment ID，OSS Path 不对外暴露。

核心领域：

```text
Record + Topic
```

支撑数据：

```text
Message + Attachment + RecordTopic
```

---

## 2. Attachment ID 与 OSS 签名地址

### 2.1 结论

保留 `attachmentId`，不要把 OSS Path 或 OSS 签名公网地址直接永久写入 Topic Markdown。

推荐链路：

```text
Topic Markdown
→ /api/attachments/{attachmentId}.{ext}
→ 后端校验 attachmentId 所属用户
→ 生成短时 OSS 签名 URL
→ 前端使用签名 URL 渲染
```

### 2.2 三种方案对比

| 方案 | 初始实现 | Topic Markdown 稳定性 | 权限 | 文件迁移 | 结论 |
|---|---|---|---|---|---|
| Markdown 保存 OSS 签名 URL | 最简单 | 差，URL 到期即失效 | 到期前持链接即可访问 | 差 | 不采用 |
| Markdown 保存 OSS Path | 较简单 | Path 相对稳定 | 客户端必须知道存储结构 | 改 Bucket/目录会影响正文 | 不采用 |
| Markdown 保存 Attachment ID | 多一张映射表 | 稳定 | 可按用户校验 | 可替换 OSS Path | 采用 |

### 2.3 为什么签名 URL 不能作为持久内容

OSS 签名 URL 包含过期时间和签名参数。Topic Markdown 会长期保存和反复被 AI 重写，如果把签名 URL 写进去：

- 数分钟或数小时后链接失效；
- 每次渲染都需要修改 Markdown；
- AI 会读到大量无意义签名参数；
- 复制 Topic 会复制已失效或仍可访问的临时凭证；
- 无法稳定更换 Bucket、对象路径或 CDN。

签名 URL 只作为一次页面渲染的临时结果。

### 2.4 Attachment ID 是否增加复杂度

只增加一个很薄的映射对象：

```text
attachmentId → userId + ossPath + mimeType + metadata
```

上传、访问和删除本来就需要知道文件归属，因此这张表不是多余领域抽象，而是 OSS 的业务访问层。

### 2.5 Topic Markdown 格式

Topic 持久化内容：

```markdown
![白板照片](/api/attachments/att_01.jpg)

[audio:会议录音](/api/attachments/att_02.mp3)

[video:演示片段](/api/attachments/att_03.mp4)
```

Topic 详情读取时，后端扫描正文中的 Attachment IDs，并返回当前短时 URL Map：

```ts
type TopicDetailResult = {
  topic: Topic
  relatedRecords: Record[]
  attachmentMap: AttachmentUrlMap
}

type AttachmentUrlMap = {
  [attachmentId: string]: string
}
```

小程序渲染器使用 `attachmentMap` 替换页面中的实际资源地址，不修改数据库里的 Markdown。

---

## 3. 总体架构

```mermaid
flowchart TB
    MP["微信小程序"]

    subgraph SERVER["Backend Process"]
        HTTP["Fastify HTTP Server"]
        APP["Application Services"]
        AGENT["Agent Runtime Module"]
        TRIGGER["Organizer Trigger"]
        SESSION["Session Runner"]
        REPO["Repository Layer"]
        ATTACH["Attachment Service"]
    end

    DB[("SQLite")]
    OSS[("阿里云 OSS")]
    MODEL["LLM / ASR Provider"]

    MP -->|HTTP / Chunk Stream| HTTP
    HTTP --> APP
    APP --> SESSION
    SESSION --> AGENT
    TRIGGER --> APP
    APP --> REPO
    AGENT --> REPO
    REPO --> DB
    HTTP --> ATTACH
    ATTACH --> OSS
    AGENT --> MODEL
```

### 3.1 HTTP Server

包含：

- Record 创建和查询；
- Topic 列表、详情和对话入口；
- 根据 `topicId + sessionId` 获取 Message 历史；
- Agent Chunk Stream；
- 附件上传、解析和访问；
- 微信登录态转业务 userId。

### 3.2 Agent Runtime

Agent Runtime 是后端模块，不是独立服务：

```ts
const context = await contextBuilder.build({
  userId,
  sessionId,
  topicId,
});

const agent = agentFactory.create(context);
await agent.prompt(message);
```

运行结束后释放 Agent 实例。长期状态都在 SQLite：

- Topic 当前正文；
- Record 原始内容和整理状态；
- Message 原始 Pi 格式；
- Topic Pending Actions。

### 3.3 Session Runner

Workspace Key：

```ts
type WorkspaceKey = `${userId}:${sessionId}`;
```

Session Runner 保证一个 Workspace 同时只有一次 Agent 执行。不同用户或不同 Session 可以并行。

Session 分配：

- Topic 创建时生成 `sessionId`；
- Topic 的多轮对话和自动整理使用同一个 Session；
- 尚未归属 Topic 的 Record 整理使用用户级系统 Session：`userId:records`；
- Session 不对应进程、目录或独立数据库。

### 3.4 Organizer Trigger

后台不再扫描 Inbox，而是直接扫描领域状态：

```mermaid
flowchart LR
    TIMER["内部定时触发器"] --> RECORDS["查询待消化 Records"]
    TIMER --> TOPICS["查询 needsOrganize Topics"]
    RECORDS --> GROUP["按 userId / session 分组"]
    TOPICS --> GROUP
    GROUP --> RUNNER["Session Runner"]
    RUNNER --> AGENT["new Agent(context)"]
    AGENT --> WRITE["更新 Record / Topic"]
```

触发周期是内部配置，不对用户承诺固定心跳时间。没有新 Record 和待整理 Topic 时不调用模型。

---

## 4. 领域模型总览

```mermaid
erDiagram
    USER ||--o{ RECORD : creates
    USER ||--o{ TOPIC : owns
    USER ||--o{ ATTACHMENT : uploads
    RECORD }o--o{ TOPIC : relates
    TOPIC ||--o{ MESSAGE : contains
    RECORD ||--o{ ATTACHMENT : contains
```

### 4.1 模型清单

| 对象 | 类型 | 作用 |
|---|---|---|
| Record | 核心领域 | 保存用户首页入口产生的原始记录 |
| Topic | 核心领域 | 保存 AI 持续整理的 Markdown 内容 |
| RecordTopic | 关系对象 | Record 与 Topic 多对多关联 |
| Message | 支撑数据 | 保存 Topic 下的 Pi Agent 原始消息 |
| Attachment | 支撑数据 | 保存 Attachment ID 与 OSS Path 映射 |

---

## 5. Record 领域

### 5.1 定义

用户从首页主入口提交的内容，创建完成后直接成为 Record，不经过 InboxItem。

一条 Record 的内容只有：

1. 必需的文本 `content`；
2. 零到多个附件 `attachmentIds`。

不设置 `contentType` 和 `action`。

### 5.2 Record 模型

```ts
type Record = {
  id: string
  userId: string

  source: 'home'
  content: string
  attachmentIds: string[]
  topicIds: string[]

  digestStatus: 'pending' | 'processing' | 'digested'

  occurredAt: string
  createdAt: string
  updatedAt: string
}
```

### 5.3 字段说明

| 字段 | 说明 |
|---|---|
| source | P0 固定为 `home`，保留字段方便未来增加分享入口等来源 |
| content | 必需、非 NULL；文字输入为原文，语音输入为 ASR 文本 |
| attachmentIds | 图片、音频、视频等附件 ID 数组 |
| topicIds | 对外 Record 对象中的多个 Topic ID |
| digestStatus | 标识是否已经被后台整理和关联 |

不再保留：

```text
contentType
action
taskId
sourceMessageId
availableAt
startedAt
completedAt
error
```

### 5.4 Record 与附件

Record 的文本始终存在：

- 纯文字：`content` 为用户原文，`attachmentIds=[]`；
- 图片：`content` 为用户说明或空字符串，附件中包含图片；
- 录音：`content` 为 ASR 文本，附件中包含原始音频；
- 视频：`content` 为用户说明、ASR 或画面摘要，附件中包含视频。

数据库约束为 `content NOT NULL`，允许空字符串。对于录音，可先创建 `content=''` 的 pending Record，ASR 完成后填充文本，再进入 Topic 整理。

### 5.5 Record 与 Topic 多对多

领域对象向外暴露 `topicIds: string[]`，数据库使用简单关系表：

```ts
type RecordTopic = {
  recordId: string
  topicId: string
  createdAt: string
}
```

不把 Topic IDs JSON 直接存进 Record 表，避免 Topic 详情查询相关记忆时扫描和解析所有 Records。

### 5.6 Record 消化逻辑

```mermaid
flowchart LR
    NEW["Record pending"] --> SCAN["Organizer Trigger"]
    SCAN --> LOAD["读取最近 Topics"]
    LOAD --> DECIDE{"关联结果"}
    DECIDE -->|匹配已有 Topic| LINK["创建 RecordTopic"]
    DECIDE -->|形成新方向| CREATE["创建 Topic + RecordTopic"]
    DECIDE -->|暂不足以成 Topic| KEEP["仅保留 Record"]
    LINK --> DONE["Record digested"]
    CREATE --> DONE
    KEEP --> DONE
```

`digested` 只表示系统已经判断过，不表示一定关联了 Topic。

---

## 6. Topic 领域

### 6.1 定义

Topic 对应用户看到的一条“回声”。它保存当前 Markdown 正文，以及多轮对话后等待 AI 吸收的 Pending Actions。

MVP 不保存 Topic 版本历史。

### 6.2 Topic 模型

```ts
type Topic = {
  id: string
  userId: string
  sessionId: string

  title: string
  summary: string
  bodyMarkdown: string
  tags: string[]
  
  pendingActions: TopicAction[]
  needsOrganize: boolean

  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}
```

### 6.3 TopicAction

TopicAction 不是 Task，不单独建表。它是 Topic 中一个等待下次整理的轻量 JSON 项：

```ts
type TopicAction = {
  id: string
  type: 'merge_insight' | 'correct' | 'reorganize'
  instruction: string
  createdAt: string
}
```

含义：

| type | 用途 |
|---|---|
| merge_insight | 将本轮新增判断、结论或行动建议融入 Topic |
| correct | 用户纠正了 Topic 中的理解 |
| reorganize | 用户明确要求阶段性总结或重新组织正文 |

`instruction` 是直接给 Organizer Agent 的整理指令，不是用户待办任务。

### 6.4 needsOrganize

`needsOrganize` 是冗余扫描字段：

- `pendingActions` 新增内容时设为 `true`；
- Trigger 只扫描 `needsOrganize=true` 的 Topics；
- Organizer 根据 Topic 当前正文、相关 Records 和 Pending Actions 生成完整新正文；
- 成功后删除本次已消费的 Action；
- 没有剩余 Action 时设为 `false`；
- 整理期间新产生的 Action 不应被误删除，只清理本次输入快照中的 Action IDs。

### 6.5 对话如何触发 Action

```mermaid
sequenceDiagram
    actor U as 用户
    participant API as Topic Chat Service
    participant AG as Agent Runtime
    participant DB as SQLite

    U->>API: Topic 下发送消息
    API->>DB: 保存 Pi user message
    API->>AG: new Agent(topic context)
    AG-->>API: 流式 AI 回复
    AG->>DB: 保存 Pi assistant/toolResult messages
    AG->>AG: 判断是否改变 Topic
    opt 需要更新 Topic
        AG->>DB: append TopicAction
        AG->>DB: needsOrganize = true
    end
```

P0 不执行 Topic 下的调研或其他长 Task；对话只包含普通多轮交流和 TopicAction 提取。

### 6.6 Topic 自动整理

Organizer 输入：

```ts
type TopicOrganizeContext = {
  topic: {
    title: string
    summary: string
    bodyMarkdown: string
  }
  relatedRecords: Array<{
    id: string
    content: string
    attachmentIds: string[]
  }>
  pendingActions: TopicAction[]
  recentMessages: PiAgentMessage[]
}
```

输出：

```ts
type TopicOrganizeResult = {
  title: string
  summary: string
  bodyMarkdown: string
  relatedRecordIds: string[]
  consumedActionIds: string[]
}
```

模型输出完整 Topic Markdown，不执行简单字符串追加。

### 6.7 Topic Markdown

正文允许：

- 标题、段落、列表、引用和表格；
- Attachment ID 图片链接；
- 自定义 audio/video 链接；
- 普通外部参考链接；
- Record 内部链接。

外部 Reference 直接写在 Markdown 中，不建立 Resource 或 SourceRef。

---

## 7. Message 模型

### 7.1 设计原则

Message 直接保存 Pi Agent 的原始事件格式，不再拆分 `content`、`tool_calls`、`response_metadata` 等字段。

只提取查询必需字段：

- userId；
- topicId；
- sessionId；
- role；
- timestamp。

完整事件原样保存在 `payload`。

### 7.2 Message 模型

```ts
type Message = {
  id: number
  userId: string
  topicId: string
  sessionId: string
  role: 'user' | 'assistant' | 'toolResult'
  payload: string
  timestamp: number
}
```

其中：

```ts
type PiMessageEvent = {
  type: 'message'
  message: PiAgentMessage
  timestamp: number
}
```

`payload = JSON.stringify(piMessageEvent)`。

### 7.3 保存示例

用户消息：

```json
{
  "type": "message",
  "message": {
    "role": "user",
    "content": "你好，做个自我介绍",
    "timestamp": 1788317490765
  },
  "timestamp": 1788317493128
}
```

Assistant 文本消息、Assistant ToolCall 和 ToolResult 都按相同方式完整写入 payload。

### 7.4 数据库表

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
```

不再设置：

```text
message_id
type
content
tool_calls
tool_call_id
name
additional
response_metadata
updated_at
```

这些数据已经完整包含在 payload 的 Pi 原始消息中。

### 7.5 消息恢复

```ts
const rows = await messageRepository.listBySession({
  userId,
  topicId,
  sessionId,
  before,
});

const agentMessages = rows.map(row => {
  const event = JSON.parse(row.payload) as PiMessageEvent;
  return event.message;
});
```

`id` 用于历史消息分页，`timestamp` 保留 Pi 的原始顺序语义。

---

## 8. Attachment 模型

### 8.1 Attachment

```ts
type Attachment = {
  id: string
  userId: string

  ossPath: string
  fileName: string
  extension: string
  mimeType: string
  size: number

  mediaType: 'image' | 'audio' | 'video' | 'file'
  durationMs?: number
  width?: number
  height?: number

  status: 'uploading' | 'ready' | 'deleted'
  createdAt: string
}
```

### 8.2 关系

P0 附件来自首页 Record 或 Topic 对话临时 ASR：

- 首页附件 ID 写入 `Record.attachmentIds`；
- Topic 中展示的持久附件应来自关联 Record；
- 对话 ASR 临时音频在转写完成后按保留策略清理；
- P0 不需要通用 EntityAttachment 关系表。

### 8.3 上传链路

```mermaid
sequenceDiagram
    participant MP as 微信小程序
    participant API as Attachment Service
    participant OSS as 阿里云 OSS
    participant DB as SQLite

    MP->>API: 上传文件
    API->>DB: 创建 Attachment uploading
    API->>OSS: 流式上传到私有 Bucket
    OSS-->>API: OSS Path / ETag
    API->>DB: 保存 ossPath，状态 ready
    API-->>MP: attachmentId
```

### 8.4 读取链路

```mermaid
sequenceDiagram
    participant MP as 微信小程序
    participant API as Topic Service
    participant DB as SQLite
    participant OSS as OSS

    MP->>API: 获取 Topic 详情
    API->>DB: 读取 Topic Markdown
    API->>DB: 根据 Attachment IDs 读取 OSS Paths
    API->>OSS: 生成短时签名 URLs
    API-->>MP: Topic + attachmentMap
```

---

## 9. SQLite 数据模型

P0 业务表：

```text
users
records
topics
record_topics
messages
attachments
```

### 9.1 records

```sql
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'home',
  content TEXT NOT NULL,
  attachment_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 9.2 topics

```sql
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  pending_actions TEXT NOT NULL DEFAULT '[]',
  needs_organize INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 9.3 record_topics

```sql
CREATE TABLE record_topics (
  record_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (record_id, topic_id)
);
```

### 9.4 messages

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
```

### 9.5 attachments

```sql
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  oss_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

JSON 仅用于：

- `records.attachment_ids`；
- `topics.pending_actions`；
- `messages.payload`。

Record 与 Topic 的关联使用关系表，不使用 JSON 数组。

---

## 10. 整体数据链路

### 10.1 首页文字输入

```mermaid
sequenceDiagram
    actor U as 用户
    participant MP as 微信小程序
    participant API as Record Service
    participant DB as SQLite
    participant TR as Organizer Trigger
    participant AG as Agent Runtime

    U->>MP: 输入文字并发送
    MP->>API: content
    API->>DB: 创建 Record pending
    API-->>MP: 返回 Record
    MP-->>U: Timeline 立即显示
    TR->>DB: 查询 pending Records
    TR->>AG: new Agent(record context)
    AG->>DB: 创建/关联/更新 Topic
    AG->>DB: Record digestStatus=digested
```

### 10.2 首页录音输入

```mermaid
sequenceDiagram
    actor U as 用户
    participant MP as 微信小程序
    participant API as Backend
    participant OSS as OSS
    participant ASR as ASR Provider
    participant DB as SQLite

    U->>MP: 完成录音
    MP->>API: 上传音频
    API->>OSS: 保存私有文件
    API->>DB: 保存 Attachment
    API-->>MP: attachmentId
    MP->>API: 创建 Record(content='', attachmentIds)
    API->>DB: Record pending
    API->>ASR: 转写音频
    ASR-->>API: transcript
    API->>DB: 更新 Record.content
```

ASR 完成后 Record 进入普通消化流程。

### 10.3 Topic 多轮对话

```mermaid
sequenceDiagram
    actor U as 用户
    participant MP as 微信小程序
    participant API as Topic Chat Service
    participant DB as SQLite
    participant AG as Agent Runtime
    participant LLM as Model Provider

    U->>MP: 发送消息
    MP->>API: topicId + sessionId + prompt
    API->>DB: 保存 Pi user message payload
    API->>AG: new Agent(context)
    AG->>DB: 加载 Topic / Records / Messages
    AG->>LLM: prompt
    LLM-->>AG: stream + optional tool calls
    AG-->>API: stream events
    API-->>MP: chunk stream
    AG->>DB: 保存 assistant/toolResult payloads
    opt 本轮改变 Topic
        AG->>DB: append pendingAction
        AG->>DB: needsOrganize=true
    end
```

### 10.4 自动整理

```mermaid
sequenceDiagram
    participant TR as Organizer Trigger
    participant DB as SQLite
    participant SR as Session Runner
    participant AG as Agent Runtime

    TR->>DB: 查询 pending Records
    TR->>DB: 查询 needsOrganize Topics
    DB-->>TR: 待处理集合
    TR->>SR: 按 Workspace 排队
    SR->>AG: new Agent(context snapshot)
    AG->>DB: 更新 Topic Markdown / RecordTopic
    AG->>DB: 清理已消费 TopicAction IDs
    AG->>DB: 更新 digestStatus / needsOrganize
```

---

## 11. 模块依赖

```mermaid
flowchart TD
    ROUTES["HTTP Routes"] --> APP["Application Services"]
    TRIGGER["Organizer Trigger"] --> APP

    APP --> RECORD["Record Module"]
    APP --> TOPIC["Topic Module"]
    APP --> MESSAGE["Message Module"]
    APP --> ATTACH["Attachment Module"]
    APP --> SESSION["Session Runner"]

    SESSION --> AGENT["Agent Runtime Facade"]
    AGENT --> CONTEXT["Context Builder"]
    AGENT --> FACTORY["Agent Factory"]
    AGENT --> TOOLS["P0 Built-in Tools"]

    RECORD --> PORTS["Repository Ports"]
    TOPIC --> PORTS
    MESSAGE --> PORTS
    ATTACH --> PORTS
    CONTEXT --> PORTS
    TOOLS --> DOMAIN["Domain Service Ports"]

    PORTS --> SQLITE["SQLite Adapters"]
    ATTACH --> OSS["OSS Adapter"]
    FACTORY --> PI["pi-agent-core / pi-ai"]
```

依赖规则：

- HTTP Routes 和 Trigger 只调用 Application Services。
- Agent Tools 不直接写 SQLite。
- Domain Modules 不依赖 Fastify、SQLite、OSS 或 Pi。
- Agent Runtime 不通过 HTTP 调用本服务。
- SQLite 通过 Repository Adapter 隔离，未来替换 PostgreSQL。

---

## 12. 后端技术栈

| 能力 | 技术选择 |
|---|---|
| 语言 | TypeScript / Node.js LTS |
| HTTP | Fastify |
| Schema | TypeBox |
| Agent Runtime | `@earendil-works/pi-agent-core` |
| 多模型 | `@earendil-works/pi-ai` |
| 数据访问 | Kysely |
| 数据库 | better-sqlite3 + WAL |
| 定时触发 | node-cron 或轻量进程内 Scheduler |
| 对象存储 | 阿里云 OSS Node SDK |
| Markdown | remark / unified 安全子集 |
| 日志 | Pino |
| 测试 | Vitest + Fastify inject |

### 12.1 SQLite 使用边界

- MVP 后端单实例部署。
- SQLite 文件放在持久化磁盘。
- 开启 WAL。
- HTTP Server、Trigger 和 Agent Runtime 共享同一个 Repository 层。
- 横向扩容前切换 PostgreSQL。
- 不引入向量数据库；P0 使用普通文本、最近 Topic 和 Agent 判断完成关联。

---

## 13. 后端目录

```text
backend/
├── package.json
├── pnpm-lock.yaml
├── src/
│   ├── main.ts
│   ├── app.ts
│   ├── config/
│   │   ├── config.ts
│   │   └── env.ts
│   ├── http/
│   │   ├── server.ts
│   │   ├── middleware/
│   │   ├── routes/
│   │   │   ├── records.routes.ts
│   │   │   ├── topics.routes.ts
│   │   │   ├── messages.routes.ts
│   │   │   ├── attachments.routes.ts
│   │   │   └── agent.routes.ts
│   │   └── stream/
│   │       └── chunk-writer.ts
│   ├── application/
│   │   ├── create-record.service.ts
│   │   ├── process-record.service.ts
│   │   ├── topic-chat.service.ts
│   │   ├── organize-topic.service.ts
│   │   └── attachment.service.ts
│   ├── modules/
│   │   ├── record/
│   │   │   ├── record.ts
│   │   │   ├── record.repository.ts
│   │   │   └── record.service.ts
│   │   ├── topic/
│   │   │   ├── topic.ts
│   │   │   ├── topic-action.ts
│   │   │   ├── record-topic.ts
│   │   │   ├── topic.repository.ts
│   │   │   └── topic.service.ts
│   │   ├── message/
│   │   │   ├── message.ts
│   │   │   └── message.repository.ts
│   │   └── attachment/
│   │       ├── attachment.ts
│   │       ├── attachment.repository.ts
│   │       └── attachment.service.ts
│   ├── agent/
│   │   ├── agent-runtime.ts
│   │   ├── agent-factory.ts
│   │   ├── agent-context.ts
│   │   ├── context-builder.ts
│   │   ├── session-runner.ts
│   │   ├── message-codec.ts
│   │   ├── model-provider.ts
│   │   ├── prompts/
│   │   │   ├── chat.prompt.ts
│   │   │   ├── record-digest.prompt.ts
│   │   │   └── topic-organize.prompt.ts
│   │   └── tools/
│   │       ├── search-records.tool.ts
│   │       └── read-topic.tool.ts
│   ├── scheduler/
│   │   ├── organizer-trigger.ts
│   │   └── scheduler.ts
│   └── infrastructure/
│       ├── database/
│       │   ├── database.ts
│       │   ├── schema.ts
│       │   ├── migrations/
│       │   └── repositories/
│       ├── oss/
│       │   ├── oss-client.ts
│       │   └── signed-url.ts
│       ├── asr/
│       └── logger/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
└── tsconfig.json
```

项目根目录保持：

```text
.
├── AGENTS.md
├── README.md
├── backend/
├── data/
├── docs/
├── frontend/
├── logs/
└── scripts/
```

不配置 pnpm workspace。Backend 和 Frontend 分别维护自己的依赖和锁文件。

---

## 14. 最终对象清单

### 14.1 保留

```text
Record
Topic
TopicAction（Topic JSON 字段，不建表）
RecordTopic
Message
Attachment
```

### 14.2 删除

```text
InboxItem
Task
TaskRun
Artifact
Conversation
EchoRevision
Resource
SourceRef
EntityAttachment
```

### 14.3 后台扫描条件

```text
records.digest_status = pending
OR
topics.needs_organize = true
```

### 14.4 最小业务闭环

```text
首页输入
→ Record
→ 自动消化
→ 关联或创建 Topic
→ Topic 多轮对话
→ 产生 TopicAction
→ needsOrganize=true
→ 自动重写 Topic Markdown
```
