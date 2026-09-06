# Contemplate 简化工作流实现拆解

历史首版拆解。当前 v2.1 的 skip_record 使用 recordIds 数组，规划校验失败可修正一次。最新流程和诊断见 [验证说明](../test/contemplate-v2.1-validation.md)。

本文档对应 `plan/contemplate-workflow-design.md`，只描述首版简化实现。目标是先验证整理效果，不提前引入过重工作流。

## 一、首版范围

实现链路：

```text
Claim → Load Context → Plan → Validate → Execute → Rewrite → Finalize
```

首版不做：

- 独立 Point 抽取步骤；
- 独立 Boundary Review 步骤；
- Plan 自动修正；
- Topic 版本历史；
- Point / Facet 独立表；
- 复杂语义评分。

## 二、目录结构

新增代码放在：

```text
apps/server/src/agent/workflows/contemplate/
├── contemplate.workflow.ts
├── context-loader.ts
├── planner.ts
├── plan-validator.ts
├── executor.ts
├── topic-rewriter.ts
├── schemas.ts
└── prompts.ts
```

旧的 `contemplate.service.ts` 已删除；路由直接使用新 workflow。

## 三、数据结构

### 3.1 Workflow Context

```ts
export interface ContemplateWorkflowContext {
  taskId: string;
  userId: string;
  records: Array<{
    id: string;
    content: string;
    status: string;
    createdAt: string;
  }>;
  topics: Array<{
    id: string;
    title: string;
    summary: string;
    content: string;
    tags: string[];
    status: string;
    updatedAt: string;
  }>;
  relatedRecordsByTopicId: Record<string, Array<{
    id: string;
    content: string;
    createdAt: string;
  }>>;
}
```

### 3.2 Plan

```ts
export type ContemplateAction =
  | {
      id: string;
      type: "merge_record";
      recordIds: string[];
      targetTopicId: string;
      facet: string;
      point: string;
      reason: string;
    }
  | {
      id: string;
      type: "create_topic";
      recordIds: string[];
      title: string;
      boundary: string;
      point: string;
      reason: string;
    }
  | {
      id: string;
      type: "merge_topic";
      targetTopicId: string;
      sourceTopicIds: string[];
      newTitle?: string;
      reason: string;
    }
  | {
      id: string;
      type: "skip_record";
      recordId: string;
      reason: string;
    };

export interface ContemplatePlan {
  actions: ContemplateAction[];
}
```

### 3.3 Rewrite Result

```ts
export interface TopicRewriteResult {
  title: string;
  summary: string;
  tags: string[];
  content: string;
}
```

## 四、Prompt 文件

`prompts.ts` 首版包含两个函数。

### 4.1 `buildPlanPrompt`

```ts
export function buildPlanPrompt(context: ContemplateWorkflowContext): string {
  return `你是 Fanto 的碎片知识整理规划器。你的任务不是把每条 Record 写成一篇 Topic 文章，而是判断这些 Record 正在推进用户的哪个长期关切。

核心定义：
- Record 是用户某个时刻的原始表达。
- Point 是 Record 中真正有价值的观点、问题、经验、方法、例证或假设。
- Facet 是 Topic 内部的一个方面。
- Topic 是用户未来可能反复进入的长期问题、方向、项目、关系或处境。

重要原则：
1. Topic 不是单条观点，不是 Record 的扩写，不是关键词分类。
2. 如果 Record 可以作为已有 Topic 的一个 Facet，优先 merge_record。
3. 如果两个已有 Topic 实际服务同一个长期关切，优先 merge_topic。
4. 只有当 Record 无法进入已有 Topic，且它本身定义了可长期生长的问题域时，才 create_topic。
5. 信息量不足、临时、没有沉淀价值的 Record，使用 skip_record。
6. 错误合并比暂时不合并更糟；但过早新建 Topic 会导致知识系统碎片化。
7. 不要因为标题、关键词、标签不同就拆成多个 Topic。判断它们未来是否应该共享同一份上下文。

共同推进测试：
对每条 Record 和候选 Topic，依次判断：
- 是否围绕同一个长期问题？
- 用户未来是否可能在同一次阅读、思考或决策中同时需要它们？
- Record 是否能为 Topic 增加新观点、方法、例证、修正、冲突或问题？
- 它是已有 Topic 的 Facet，还是必须成为新 Topic？

输出要求：
- 只输出 JSON，不要输出 Markdown，不要解释。
- 每条输入 Record 必须被一个 action 覆盖。
- merge_record 必须包含 recordIds、targetTopicId、facet、point、reason。
- create_topic 必须包含 recordIds、title、boundary、point、reason。
- merge_topic 必须包含 targetTopicId、sourceTopicIds、reason，可选 newTitle。
- skip_record 必须包含 recordId、reason。
- 不允许编造 recordId 或 topicId。
- reason 必须具体说明为什么这样归属，而不是泛泛说“语义相关”。

输入数据：

待处理 Records：
${JSON.stringify(context.records, null, 2)}

候选 Topics：
${JSON.stringify(context.topics, null, 2)}

候选 Topic 的关联 Records：
${JSON.stringify(context.relatedRecordsByTopicId, null, 2)}

请输出 JSON，格式如下：
{
  "actions": [
    {
      "id": "action-1",
      "type": "merge_record",
      "recordIds": ["..."],
      "targetTopicId": "...",
      "facet": "...",
      "point": "...",
      "reason": "..."
    }
  ]
}`;
}
```

### 4.2 `buildRewritePrompt`

```ts
export function buildRewritePrompt(input: {
  targetTopic: unknown;
  records: unknown[];
  actions: ContemplateAction[];
  sourceTopics: unknown[];
  relatedRecords: unknown[];
}): string {
  return `你是 Fanto 的 Topic 内容整理器。你的任务是把新 Record 吸收到一个长期 Topic 中，让 Topic 更清晰、更有结构，而不是把 Record 简单扩写或追加。

Topic 定义：
Topic 是用户未来会反复进入的长期问题域。它应该容纳多个 Facet，而不是只表达一条观点。

写作原则：
1. 保留用户明确表达的判断，不要把它改写成客观事实。
2. 对 Fanto 的推断要明确表达为“可能”“可以理解为”“当前看起来”。
3. 不要过度扩写，不要写空泛套话。
4. 不要按 Record 顺序堆叠内容，要按 Facet 重组。
5. 如果新内容只是例证或方法，把它放到合适的小节中。
6. 如果新内容修正了旧判断，更新原判断，并保留必要的不确定性。
7. 如果多个 source Topic 被合并，删除重复表达，保留真正不同的 Facet。
8. content 使用 Markdown，但不要为了显得完整而制造没有依据的章节。

输入数据：

目标 Topic：
${JSON.stringify(input.targetTopic, null, 2)}

本次需要吸收的 Records：
${JSON.stringify(input.records, null, 2)}

本次执行的 Actions：
${JSON.stringify(input.actions, null, 2)}

被合并的 source Topics：
${JSON.stringify(input.sourceTopics, null, 2)}

目标 Topic 已关联的历史 Records 摘要：
${JSON.stringify(input.relatedRecords, null, 2)}

输出要求：
- 只输出 JSON，不要输出额外解释。
- title 应是长期问题域标题，不要贴着单条 Record。
- summary 用 1 到 2 句话说明这个 Topic 的长期关注点。
- tags 保持 3 到 6 个。
- content 是完整 Markdown 正文。
- content 必须区分“用户明确判断”“Fanto 的整理理解”“仍需验证/继续探索的问题”。

输出 JSON 格式：
{
  "title": "...",
  "summary": "...",
  "tags": ["..."],
  "content": "..."
}`;
}
```

## 五、实现任务

### Task 1：定义 schemas

文件：

```text
apps/server/src/agent/workflows/contemplate/schemas.ts
```

内容：

- `ContemplateWorkflowContext`
- `ContemplateAction`
- `ContemplatePlan`
- `TopicRewriteResult`
- 简单运行时校验函数

验收：

- Plan JSON 不合法时能报出明确错误；
- action 类型只允许首版四种：`merge_record/create_topic/merge_topic/skip_record`。

### Task 2：实现 Context Loader

文件：

```text
apps/server/src/agent/workflows/contemplate/context-loader.ts
```

逻辑：

1. 读取本批 claimed Records；
2. 读取最近 active Topics；
3. 对每条 Record 用向量搜索召回相关 Topics；
4. 合并去重得到候选 Topics；
5. 加载候选 Topic 的关联 Records。

降级：

- 如果向量不可用，使用最近 active Topics；
- 如果当前没有 Topic，允许 Plan 创建新 Topic。

验收：

- 日志能看到 recordCount、candidateTopicCount；
- 不因为 embedding 失败中断整理任务。

### Task 3：实现 Planner

文件：

```text
apps/server/src/agent/workflows/contemplate/planner.ts
apps/server/src/agent/workflows/contemplate/prompts.ts
```

逻辑：

1. 使用 `buildPlanPrompt(context)`；
2. 调用模型；
3. 解析 JSON；
4. 校验为 `ContemplatePlan`。

验收：

- 当前 6 条测试数据中，应倾向输出 2 个长期 Topic 方向；
- 不应为每条 Record 输出一个 `create_topic`；
- reason 不能只是“语义相关”。

### Task 4：实现 Plan Validator

文件：

```text
apps/server/src/agent/workflows/contemplate/plan-validator.ts
```

首版校验：

- 每条 claimed Record 必须被覆盖；
- 所有 recordId/topicId 存在；
- `merge_record` target 必须是 active Topic；
- `create_topic` 必须有 title、boundary、recordIds；
- `merge_topic` 的 source 不包含 target；
- 每个 source Topic 只能被合并一次；
- 每条 Record 自动关联不超过 2 个 Topic。

处理策略：

- 校验不通过，Task 直接 failed；
- 记录 violations；
- 恢复 claimed Records 原状态；
- 不做 revise。

验收：

- 明显错误 plan 不会写库；
- 失败日志包含 taskId、step、violations。

### Task 5：扩展 TopicRepository

需要新增能力：

```ts
updateStatus(topicId: string, status: "active" | "archived"): Promise<void>;
moveRecordTopics(sourceTopicId: string, targetTopicId: string): Promise<void>;
findRelatedRecordsByTopicId(topicId: string): Promise<Record[]>;
```

验收：

- Topic 合并后 source Topic 不再出现在 active 列表；
- source Topic 的 RecordTopic 关系迁移到 target Topic；
- 重复关联不会写出重复数据。

### Task 6：实现 Executor

文件：

```text
apps/server/src/agent/workflows/contemplate/executor.ts
```

执行顺序：

```text
merge_topic → create_topic → merge_record → skip_record
```

职责：

- 数据库动作全部由代码执行；
- 收集受影响 Topics；
- 记录 skipped Records；
- 生成 rewrite 输入；
- 写入 Task result.execution。

验收：

- LLM 不直接写库；
- 任一 action 失败能定位 actionId；
- RecordTopic 关联完整。

### Task 7：实现 Topic Rewriter

文件：

```text
apps/server/src/agent/workflows/contemplate/topic-rewriter.ts
```

逻辑：

1. 对每个受影响 Topic 构造 `buildRewritePrompt`；
2. 调用模型生成 `title/summary/tags/content`；
3. 代码写入 Topic；
4. 重建该 Topic 向量。

验收：

- Topic content 按 Facet 组织；
- 用户假设不被写成事实；
- 合并后的 Topic 比多个小 Topic 更适合重读；
- 不只是把 Record 原文扩写变长。

### Task 8：实现 Workflow Service

文件：

```text
apps/server/src/agent/workflows/contemplate/contemplate.workflow.ts
```

编排：

```text
claim records
load context
plan
validate
execute
rewrite topics
finalize
```

失败处理：

- Task 标记 `failed`；
- 保存 error；
- 恢复 claimed Records 原状态；
- 日志包含 taskId、step。

验收：

- 无 Records 时不调用模型；
- 成功后 Records 变为 `organized` 或 `skipped`；
- Task result 包含 plan、validation、execution、rewrites、skipped。

### Task 9：切换 API 入口

目标：

- `/api/contemplate` 调用新 workflow；
- 旧 `contemplate.service.ts` 暂时保留，便于对照；
- 返回格式保持兼容。

验收：

- 调用方式不变；
- 日志能区分 `contemplate-v2-simple`。

### Task 10：更新测试文档

目标：

- 更新 `docs/` 中的链路测试说明；
- 加入当前 6 条测试数据；
- 明确验收结果应是 2 个 Topic。

验收：

- 能按文档创建 Records、触发整理、检查 Topics 和 RecordTopic；
- 能通过日志定位 Plan、Validate、Execute、Rewrite 阶段。

## 六、日志要求

统一 scope：

```text
contemplate-v2
```

关键日志：

```text
claim start
records claimed
context loaded
plan prompt start
plan generated
plan validation failed
plan validation passed
action executed
rewrite prompt start
topic rewritten
records finalized
task completed
task failed
records restored
```

日志要求：

- 必须包含 `taskId`；
- 必须包含 step；
- 记录 count，不打印完整长正文；
- LLM 原始输出只在解析失败时截断记录。

## 七、验收用例

当前 6 条测试 Records 触发一次整理后：

期望：

- 最终 active Topics 收敛到 2 个左右；
- AI Coding、Agent 协作、Mermaid 文档、git worktree、AI Native 工程能力进入同一个 Topic；
- Fanto 碎片记录产品理念和保守合并原则进入同一个 Topic；
- 不继续生成每条 Record 一个 Topic；
- RecordTopic 关联完整；
- Task result 能解释为什么合并。

如果首版仍出现 Topic 爆炸，再进入下一轮优化：

- 拆出独立 Extract Points；
- 拆出 Boundary Review；
- 增加 Plan revise；
- 增加 Topic 粒度质量评估。
