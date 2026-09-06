import type { ContemplateAction, ContemplateWorkflowContext } from "./schemas.js";

export function buildPlanPrompt(context: ContemplateWorkflowContext, currentTime: string): string {
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
4. 当一条或多条 Record 无法进入已有 Topic，且共同定义了可长期生长的问题域时，才 create_topic。
5. 信息量不足、临时、没有沉淀价值的 Record，使用 skip_record。
6. 错误合并比暂时不合并更糟；但过早新建 Topic 会导致知识系统碎片化。
7. 不要因为标题、关键词、标签不同就拆成多个 Topic。判断它们未来是否应该共享同一份上下文。

决策顺序和边界：
- 先联合阅读本批全部 Records，识别共同推进的长期问题，再与候选 Topics 比较。不要逐条寻找一个“最接近”的 Topic 就结束。
- 候选 Topics 只是可能相关的上下文，不是必须选一个的分类列表。
- 只有讨论对象和长期问题一致，才归入已有 Topic。相同关键词、都涉及工具或个人成长，不足以构成归属依据。
- 不相关的记录不得放入已有 Topic 的“其他”或“待探索”章节。没有更合适的已有 Topic，不是合并理由。
- 多条记录共同构成一个长期问题时，可以共同创建一个 Topic。不要求每条记录单独具备完整的问题定义。
- 单条记录也可以创建 Topic，前提是明确表达持续关注的问题。不设最低记录数量，不为压低 Topic 数量而强行合并。
- 没有匹配 Topic、且当前不足以形成长期问题的记录可以跳过。跳过只表示本轮不归档。
- 同属一个新问题的记录使用一个 create_topic，避免各建一个。
- 反例：已有软件工程 Topic 时，运动训练记录不能因为“都在优化方法”而归入；连续训练观察可以形成自己的 Topic。

共同推进测试：
对每条 Record 和候选 Topic，依次判断：
- 是否围绕同一个长期问题？
- 用户未来是否可能在同一次阅读、思考或决策中同时需要它们？
- Record 是否能为 Topic 增加新观点、方法、例证、修正、冲突或问题？
- 它是已有 Topic 的 Facet，还是必须成为新 Topic？

输出要求：
- 只输出 JSON，不要输出 Markdown，不要解释。
- 每条输入 Record 必须恰好被一个 merge_record、create_topic 或 skip_record action 覆盖，数组必须非空且 ID 不重复。
- merge_record 必须包含 recordIds、targetTopicId、facet、point、reason。
- create_topic 必须包含 recordIds、title、boundary、point、reason。
- merge_topic 必须包含 targetTopicId、sourceTopicIds、reason，可选 newTitle。
- skip_record 必须包含 recordIds 数组、reason。即使只有一条也使用 recordIds，不使用 recordId。
- 不允许编造 recordId 或 topicId。
- reason 用 1 到 2 句话说明共同问题和新增作用，不要输出互相矛盾的理由，不要泛泛说“语义相关”。
- reason 面向用户解释已做的整理判断，跳过只说“目前暂未归入”，不要评价用户表达无意义或无价值。
- merge_topic 的 sourceTopicIds 将被归档，本计划中的任何动作不得以它们作为 targetTopicId。

输入数据：

当前时间：
${currentTime}

待处理 Records：
${JSON.stringify(context.records, null, 2)}

候选 Topics：
${JSON.stringify(context.topics, null, 2)}

候选 Topic 的关联 Records：
${JSON.stringify(context.relatedRecordsByTopicId, null, 2)}

请输出 JSON。以下示例只展示四种动作格式，ID 均为占位符；仅输出需要的动作，不必凑齐四种：
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
    },
    {
      "id": "action-2",
      "type": "create_topic",
      "recordIds": ["..."],
      "title": "...",
      "boundary": "...",
      "point": "...",
      "reason": "..."
    },
    {
      "id": "action-3",
      "type": "skip_record",
      "recordIds": ["..."],
      "reason": "..."
    },
    {
      "id": "action-4",
      "type": "merge_topic",
      "targetTopicId": "...",
      "sourceTopicIds": ["..."],
      "reason": "..."
    }
  ]
}`;
}

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
9. 原始 Record 是依据，已有 Topic 和规划 point 是整理产物，不是独立事实。不得循环引用旧整理内容为推断提供依据。
10. 明确修正旧判断的记录应更新相应结论，并保留必要的变化说明；不受修正影响的历史观点和方法应保留。
11. 没有依据的因果解释必须删除，添加“可能”并不能补足依据。没有新增推断或探索问题时，省略对应章节。
12. “当前有效关联 Records”是本 Topic 的完整原始依据。记录可能已修改或移走，旧正文或 source Topic 中不再被这些记录支持的内容必须删除或修正。不能为了保留历史而残留失效内容。

输入数据：

目标 Topic：
${JSON.stringify(input.targetTopic, null, 2)}

本次需要吸收的 Records：
${JSON.stringify(input.records, null, 2)}

本次执行的 Actions：
${JSON.stringify(input.actions, null, 2)}

被合并的 source Topics：
${JSON.stringify(input.sourceTopics, null, 2)}

当前有效关联 Records（完整原始依据）：
${JSON.stringify(input.relatedRecords, null, 2)}

输出要求：
- 只输出 JSON，不要输出额外解释。
- title 应是长期问题域标题，不要贴着单条 Record。
- summary 用 1 到 2 句话说明这个 Topic 的长期关注点。
- tags 保持 3 到 6 个。
- content 是完整 Markdown 正文。
- changeSummary 用一句面向用户的话说明本次新增、修正或移除的内容；不是整个话题的摘要，不得编造变化。
- content 中如果存在整理推断或待验证问题，必须与用户明确判断区分；无需固定三类章节，不得为填充章节制造内容。

输出 JSON 格式：
{
  "title": "...",
  "summary": "...",
  "changeSummary": "...",
  "tags": ["..."],
  "content": "..."
}`;
}
