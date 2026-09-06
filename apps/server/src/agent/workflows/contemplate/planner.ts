import type { AppConfig } from "../../../env.js";
import { nowIso } from "../../../infrastructure/time.js";
import { buildPlanPrompt } from "./prompts.js";
import { assertContemplatePlan, type ContemplatePlan, type ContemplateWorkflowContext } from "./schemas.js";
import { runJsonStep, PlanValidationError, type JsonAttempt, type JsonCompletion } from "./llm-json.js";
import type { TopicRepository } from "../../../modules/topic/topic.repository.js";
import { validateContemplatePlan } from "./plan-validator.js";

export async function planContemplate(opts: {
  config: AppConfig;
  context: ContemplateWorkflowContext;
  topicRepo: TopicRepository;
  onAttempt: (attempt: JsonAttempt) => Promise<void>;
  complete?: (prompt: string) => Promise<JsonCompletion>;
}): Promise<ContemplatePlan> {
  return runJsonStep({
    config: opts.config,
    taskId: opts.context.taskId,
    step: "plan",
    prompt: buildPlanPrompt(opts.context, nowIso()),
    maxAttempts: 2,
    onAttempt: opts.onAttempt,
    complete: opts.complete,
    validate: async (value) => {
      const plan = assertContemplatePlan(value);
      const validation = await validateContemplatePlan({ plan, context: opts.context, topicRepo: opts.topicRepo });
      if (!validation.passed) throw new PlanValidationError(validation.violations);
      return plan;
    },
  });
}
