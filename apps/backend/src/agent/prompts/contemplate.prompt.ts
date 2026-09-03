import type { Record } from "../../modules/record/record.js";
import type { Topic } from "../../modules/topic/topic.js";

export function buildContemplatePrompt(records: Record[], topics: Topic[], taskId: string, currentTime = new Date().toISOString()): string {
  const recordsText = records.map((record) => [
    "---",
    `[Record ID: ${record.id}]`,
    `occurredAt: ${record.occurredAt}`,
    record.content,
    "---",
  ].join("\n")).join("\n\n");

  const topicsSummary = topics.length > 0
    ? JSON.stringify(topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      tags: topic.tags,
      updatedAt: topic.updatedAt,
    })), null, 2)
    : "（暂无 Topic）";

  return `你正在执行 Eiko 的 Record 沉思整理任务。任务分三个阶段：Plan → Execute → Verify。

工具：
- rag_search(scope, query): 通过向量搜索相关 topic 或 record
- get_topic(topicId): 获取 topic 完整详情
- get_record(recordId): 获取 record 完整内容
- create_topic(...): 创建新 topic
- update_topic(...): 更新已有 topic
- link_record_topic(recordId, topicId, relation): 建立 Record 与 Topic 的关系
- update_task(status, result): 更新任务状态和结果

Plan 阶段：
1. 阅读待整理的 Record。
2. 对每条 Record 使用 rag_search(scope="topic") 查找可能相关的已有 Topic。
3. 分析每条 Record 与已有 Topic 的关系，产出整理计划。
4. 通过 update_task(status="planning", result={ plan }) 写入 plan。

Plan JSON 格式：
{
  "plan": {
    "items": [
      {
        "id": "plan-1",
        "recordIds": ["..."],
        "action": "merge" | "create",
        "targetTopicId": "...",
        "proposedTitle": "...",
        "proposedSummary": "...",
        "reason": "..."
      }
    ],
    "skipped": [
      { "recordId": "...", "reason": "..." }
    ]
  }
}

跳过规则：
- 纯临时信息可以跳过；
- 信息密度极低、没有沉淀价值的记录可以跳过；
- 独立但信息丰富的记录不要跳过，应创建 Topic。

Execute 阶段：
- merge: get_topic 获取完整内容 → 结合 record 重新思考 → update_topic 提交完整新内容 → link_record_topic 关联本项 records。
- create: 理解 record → create_topic 创建新 topic → link_record_topic 关联本项 records。
- 每项完成后调用 update_task(status="executing", result={ execution: { "plan-N": { status: "done", topicId, action, linkedRecordIds } } })。

Verify 阶段：
- 检查每个 plan item 都已创建或更新 Topic，并且关联了对应 Record。
- 当前验证通过后调用 update_task(status="completed", result={ verification: { passed: true, unresolved: [] } })。

关联原则：
- 错误合并比暂时不合并更糟；不确定时跳过或创建新 Topic。
- 仅仅标签或关键词相同，不构成关联理由。
- 每条 Record 最多自动关联两个 Topic。
- Topic 正文要输出完整 Markdown，不要只追加 Record 原文。

输入数据：
当前时间：${currentTime}
任务 ID：${taskId}

待整理的 Record（共 ${records.length} 条）：
${recordsText}

用户最近 Topics 概览（用于 rag_search 不可用时降级，共 ${topics.length} 个）：
${topicsSummary}`;
}
