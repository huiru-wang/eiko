# Contemplate v2.1 验证

## 自动化回归

在 apps/server 下执行：

```bash
node --import tsx --test src/agent/workflows/contemplate/planner.test.ts src/routes/records.test.ts
```

覆盖空数组、重复 ID、旧 skip 字段、遗漏和未知记录、跨动作重复覆盖、归档目标冲突、批量跳过展开，以及三类校验错误各自修正成功、混合错误共用一次额度、输出截断和模型错误不重试、诊断持久化失败不重试。数据库写入测试使用内存 SQLite。

## 真实模型评估

从 apps/server 运行 `node --import tsx src/agent/workflows/contemplate/contemplate.eval.ts`。该命令会调用 .env 配置的模型和向量服务，使用当前数据库只读备份，依次对原序和逆序副本运行完整工作流。适用前提：原库有两个基线 Topic 和十条待整理增量记录。它不会向原库写入，副本路径打印在控制台。

检查两个副本均达到 docs/records-batch.md 的预期：保留旧 Topic ID，新增睡眠和咖啡 Topic，提醒 skipped，其余九条 organized。标题无需逐字相同。必须人工检查分组，以及正文是否修正“注意力稀释”和 worktree 的错误因果解释、是否保留旧内容。仅数量断言通过不代表语义验收通过。

## 诊断

任务详情 result.planningAttempts 中每次包含 attempt、output、stopReason、durationMs、passed。失败时包含 errorCode、error，以及适用的 violations/failedActions。

| errorCode | 含义 | 自动修正 |
|---|---|---|
| JSON_PARSE_ERROR | 无法解析完整 JSON | 规划阶段一次 |
| ACTION_SCHEMA_ERROR | 动作结构不合约定 | 与其他规划错误共用一次 |
| PLAN_VALIDATION_ERROR | ID、覆盖或归档规则不通过 | 与其他规划错误共用一次 |
| OUTPUT_TRUNCATED | 模型达到输出上限 | 否 |
| MODEL_ERROR | 连接或模型调用失败 | 否 |
| OUTPUT_SCHEMA_ERROR | Topic 改写结构不通过 | 否 |

结构错误日志会打印对应 action，包括位于响应中后段的 action。完整规划输出仅保存在任务结果中。二次规划失败时应确认没有执行日志，任务 failed，领取的记录恢复原状态。执行阶段失败不能据此推断 Topic 写入已回滚。

## 本次验证结果

- 本地自动化回归及类型检查通过。
- 隔离副本网络失败路径触发 MODEL_ERROR，记录恢复原状态。
- 真实模型联网重试被自动审批拒绝，原序与换序的语义效果尚未验收。
