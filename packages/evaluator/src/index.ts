import {
  createEvent,
  type ConversationTurn,
  type CollectorMetrics,
  type CorrectionEvent,
  type CorrectionType,
  type CursorConversation,
  type CursorMessage,
  type FrictionEvent,
  type RunContext,
  type Severity,
  type TaskComplexity,
  type TaskEvaluation,
  type TaskOutcome,
  type TaskSummary,
  type TaskType,
  type WorkflowEvent
} from "@awo/schema";

export interface CursorEvaluationResult {
  events: WorkflowEvent[];
  tasks: TaskSummary[];
  evaluations: TaskEvaluation[];
  metrics: CollectorMetrics;
}

export function evaluateCursorConversations(
  conversations: CursorConversation[],
  evaluatedAt: string,
  context?: RunContext
): CursorEvaluationResult {
  const events: WorkflowEvent[] = [];
  const tasks: TaskSummary[] = [];
  const evaluations: TaskEvaluation[] = [];

  for (const conversation of conversations) {
    const taskId = `cursor:${conversation.conversationId}`;
    events.push(...conversationToEvents(conversation, taskId, evaluatedAt));

    const evaluation = evaluateConversation(conversation, taskId, evaluatedAt);
    const turns = mergeMessagesToTurns(conversation.messages);
    const summary = summarizeConversation(conversation, taskId, evaluation, turns, context);

    tasks.push(summary);
    evaluations.push(evaluation);
  }

  return {
    events,
    tasks,
    evaluations,
    metrics: calculateMetrics(conversations.length, tasks, evaluations)
  };
}

function conversationToEvents(conversation: CursorConversation, taskId: string, generatedAt: string): WorkflowEvent[] {
  const timestamp = conversation.startedAt ?? firstMessageTimestamp(conversation.messages) ?? generatedAt;
  const events: WorkflowEvent[] = [
    createEvent({
      id: stableEventId(taskId, "task_started", conversation.conversationId),
      source: "cursor",
      eventType: "task_started",
      timestamp,
      workspaceId: conversation.workspaceId,
      taskId,
      payload: {
        conversationId: conversation.conversationId,
        title: conversation.title,
        status: conversation.status ?? "unknown"
      }
    })
  ];

  for (const message of conversation.messages) {
    const eventType = message.role === "user" ? "user_prompt" : message.role === "assistant" ? "assistant_response" : undefined;
    if (!eventType) continue;

    events.push(
      createEvent({
        id: stableEventId(taskId, eventType, message.messageId),
        source: "cursor",
        eventType,
        timestamp: message.timestamp ?? timestamp,
        workspaceId: conversation.workspaceId,
        taskId,
        payload: {
          conversationId: conversation.conversationId,
          messageId: message.messageId,
          role: message.role,
          text: message.text,
          textLength: message.text.length
        }
      })
    );
  }

  events.push(
    createEvent({
      id: stableEventId(taskId, outcomeEventType(conversation), conversation.conversationId),
      source: "cursor",
      eventType: outcomeEventType(conversation),
      timestamp: conversation.updatedAt ?? lastMessageTimestamp(conversation.messages) ?? timestamp,
      workspaceId: conversation.workspaceId,
      taskId,
      payload: {
        conversationId: conversation.conversationId,
        outcome: inferOutcome(conversation)
      }
    })
  );

  return events;
}

function summarizeConversation(
  conversation: CursorConversation,
  taskId: string,
  evaluation: TaskEvaluation,
  turns: ConversationTurn[],
  context: RunContext | undefined
): TaskSummary {
  const userMessages = conversation.messages.filter((message) => message.role === "user");
  const assistantMessages = conversation.messages.filter((message) => message.role === "assistant");
  const userTurns = turns.filter((turn) => turn.role === "user");
  const assistantTurns = turns.filter((turn) => turn.role === "assistant");

  return {
    taskId,
    source: "cursor",
    context,
    sourceConversationId: conversation.conversationId,
    title: conversation.title,
    taskType: evaluation.taskType,
    complexity: evaluation.complexity,
    outcome: evaluation.outcome,
    startedAt: conversation.startedAt ?? firstMessageTimestamp(conversation.messages),
    endedAt: conversation.updatedAt ?? lastMessageTimestamp(conversation.messages),
    messageCount: conversation.messages.length,
    turnCount: turns.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    userTurnCount: userTurns.length,
    assistantTurnCount: assistantTurns.length,
    userInputChars: sumChars(userMessages),
    assistantOutputChars: sumChars(assistantMessages),
    turns,
    correctionCount: evaluation.corrections.length,
    frictionEventCount: evaluation.frictionEvents.length
  };
}

function evaluateConversation(conversation: CursorConversation, taskId: string, evaluatedAt: string): TaskEvaluation {
  const taskType = inferTaskType(conversation);
  const complexity = inferComplexity(conversation);
  const outcome = inferOutcome(conversation);
  const turns = mergeMessagesToTurns(conversation.messages);
  const corrections = detectCorrections(conversation, turns);
  const frictionEvents = detectFriction(conversation, turns, corrections, outcome);

  return {
    taskId,
    source: "cursor",
    evaluatedAt,
    evaluator: "heuristic-v0",
    taskType,
    complexity,
    outcome,
    corrections,
    frictionEvents,
    confidence: confidenceFor(conversation, corrections),
    notes: [
      "Heuristic evaluation based on Cursor conversation text and message structure.",
      "Use model-based evaluator later for taxonomy calibration."
    ]
  };
}

function detectCorrections(conversation: CursorConversation, turns: ConversationTurn[]): CorrectionEvent[] {
  const corrections: CorrectionEvent[] = [];
  const userTurns = turns.filter((turn) => turn.role === "user");

  for (let index = 1; index < userTurns.length; index += 1) {
    const turn = userTurns[index];
    const text = normalizeText(turn.text);
    const match = classifyCorrection(text);
    if (!match) continue;

    corrections.push({
      eventId: stableEventId(conversation.conversationId, "correction", turn.turnId),
      messageId: turn.messageIds[0] ?? turn.turnId,
      type: match.type,
      severity: match.severity,
      evidence: truncateEvidence(turn.text)
    });
  }

  return corrections;
}

function detectFriction(
  conversation: CursorConversation,
  turns: ConversationTurn[],
  corrections: CorrectionEvent[],
  outcome: TaskOutcome
): FrictionEvent[] {
  const friction: FrictionEvent[] = corrections.map((correction) => ({
    eventId: stableEventId(conversation.conversationId, "friction_correction", correction.messageId),
    type: "correction",
    severity: correction.severity,
    evidence: correction.evidence
  }));

  if (outcome === "abandoned") {
    friction.push({
      eventId: stableEventId(conversation.conversationId, "friction_abandonment", conversation.conversationId),
      type: "abandonment",
      severity: "high",
      evidence: "Cursor conversation status indicates the task was aborted."
    });
  }

  const userTurnCount = turns.filter((turn) => turn.role === "user").length;
  if (userTurnCount >= 8) {
    friction.push({
      eventId: stableEventId(conversation.conversationId, "friction_long_iteration", String(userTurnCount)),
      type: "long_iteration",
      severity: userTurnCount >= 16 ? "high" : "medium",
      evidence: `Conversation contains ${userTurnCount} user turns.`
    });
  }

  const lowSignalCount = turns.filter(
    (turn) => turn.role === "user" && normalizeText(turn.text).length <= 6
  ).length;
  if (lowSignalCount >= 3) {
    friction.push({
      eventId: stableEventId(conversation.conversationId, "friction_low_signal", String(lowSignalCount)),
      type: "low_signal_exchange",
      severity: "low",
      evidence: `Conversation contains ${lowSignalCount} very short user turns.`
    });
  }

  return friction;
}

function classifyCorrection(text: string): { type: CorrectionType; severity: Severity } | undefined {
  const rules: Array<{ pattern: RegExp; type: CorrectionType; severity: Severity }> = [
    { pattern: /(不对|不是这个意思|理解错|你理解错|方向错|wrong|not what i meant|misunderstood)/i, type: "misinterpretation", severity: "high" },
    { pattern: /(报错|失败|不能运行|跑不起来|error|failed|failing|does not work|doesn't work|broken)/i, type: "execution_failure", severity: "high" },
    { pattern: /(漏了|没有处理|没考虑|missing|missed|forgot)/i, type: "missed_requirement", severity: "medium" },
    { pattern: /(错了|错误|bug|incorrect|fix this|修复|修一下)/i, type: "error_correction", severity: "medium" },
    { pattern: /(重新|重做|回滚|改回|rewrite|redo|rollback|rework)/i, type: "scope_change", severity: "medium" },
    { pattern: /(改成|换成|不要.*要|instead|prefer|style|格式|文案)/i, type: "preference_adjustment", severity: "low" },
    { pattern: /(补充|澄清|我的意思是|clarify|to be clear)/i, type: "clarification", severity: "low" },
    { pattern: /(太差|不满意|质量|不够好|bad|poor quality|not good enough)/i, type: "quality_feedback", severity: "medium" }
  ];

  return rules.find((rule) => rule.pattern.test(text));
}

function inferTaskType(conversation: CursorConversation): TaskType {
  const text = normalizeText(`${conversation.title ?? ""}\n${conversation.messages.map((message) => message.text).join("\n")}`);
  const rules: Array<{ pattern: RegExp; type: TaskType }> = [
    { pattern: /(bug|报错|错误|修复|fix|failed|failure|exception|debug)/i, type: "bugfix" },
    { pattern: /(test|测试|单测|e2e|spec)/i, type: "test_generation" },
    { pattern: /(refactor|重构|整理代码|优化结构)/i, type: "refactor" },
    { pattern: /(review|审查|评审|code review|pr)/i, type: "code_review" },
    { pattern: /(文档|readme|document|docs|说明)/i, type: "documentation" },
    { pattern: /(解释|说明一下|explain|summarize|总结|结构)/i, type: "code_explanation" },
    { pattern: /(计划|方案|设计|架构|plan|design|architecture)/i, type: "planning" },
    { pattern: /(实现|新增|添加|开发|feature|build|create)/i, type: "feature" }
  ];

  return rules.find((rule) => rule.pattern.test(text))?.type ?? "general";
}

function inferComplexity(conversation: CursorConversation): TaskComplexity {
  const turns = mergeMessagesToTurns(conversation.messages);
  const userCount = turns.filter((turn) => turn.role === "user").length;
  const totalChars = sumChars(conversation.messages);
  if (userCount >= 12 || totalChars >= 50_000) return "large";
  if (userCount >= 4 || totalChars >= 8_000) return "medium";
  return "small";
}

function inferOutcome(conversation: CursorConversation): TaskOutcome {
  if (conversation.status === "aborted") return "abandoned";
  if (conversation.status === "completed") return "completed";
  const last = conversation.messages[conversation.messages.length - 1];
  if (last?.role === "assistant") return "completed";
  return "unknown";
}

function outcomeEventType(conversation: CursorConversation): "task_completed" | "task_abandoned" {
  return inferOutcome(conversation) === "abandoned" ? "task_abandoned" : "task_completed";
}

function calculateMetrics(conversationCount: number, tasks: TaskSummary[], evaluations: TaskEvaluation[]): CollectorMetrics {
  const completed = tasks.filter((task) => task.outcome === "completed").length;
  const correctionCount = evaluations.reduce((sum, evaluation) => sum + evaluation.corrections.length, 0);
  const frictionEventCount = evaluations.reduce((sum, evaluation) => sum + evaluation.frictionEvents.length, 0);

  return {
    taskCount: tasks.length,
    conversationCount,
    messageCount: tasks.reduce((sum, task) => sum + task.messageCount, 0),
    correctionCount,
    frictionEventCount,
    completionRate: tasks.length > 0 ? completed / tasks.length : null,
    averageCorrectionsPerTask: tasks.length > 0 ? correctionCount / tasks.length : null,
    averageTurnsPerTask: tasks.length > 0 ? tasks.reduce((sum, task) => sum + task.turnCount, 0) / tasks.length : null,
    averageUserTurnsPerTask: tasks.length > 0 ? tasks.reduce((sum, task) => sum + task.userTurnCount, 0) / tasks.length : null,
    averageAssistantTurnsPerTask: tasks.length > 0 ? tasks.reduce((sum, task) => sum + task.assistantTurnCount, 0) / tasks.length : null,
    averageUserMessagesPerTask: tasks.length > 0 ? tasks.reduce((sum, task) => sum + task.userMessageCount, 0) / tasks.length : null,
    averageAssistantMessagesPerTask: tasks.length > 0 ? tasks.reduce((sum, task) => sum + task.assistantMessageCount, 0) / tasks.length : null
  };
}

export function mergeMessagesToTurns(messages: CursorMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  for (const message of messages) {
    const previous = turns[turns.length - 1];
    const canMerge = previous && previous.role === message.role;

    if (canMerge) {
      previous.messageIds.push(message.messageId);
      previous.text = joinTurnText(previous.text, message.text);
      previous.endedAt = message.timestamp ?? previous.endedAt;
      continue;
    }

    turns.push({
      turnId: stableEventId("turn", message.messageId),
      role: message.role,
      messageIds: [message.messageId],
      text: message.text,
      startedAt: message.timestamp,
      endedAt: message.timestamp
    });
  }

  return turns;
}

function joinTurnText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return `${left}\n\n${right}`;
}

function confidenceFor(conversation: CursorConversation, corrections: CorrectionEvent[]): number {
  if (conversation.messages.length === 0) return 0.1;
  if (corrections.length > 0) return 0.75;
  if (conversation.messages.length >= 4) return 0.55;
  return 0.4;
}

function firstMessageTimestamp(messages: CursorMessage[]): string | undefined {
  return messages.find((message) => message.timestamp)?.timestamp;
}

function lastMessageTimestamp(messages: CursorMessage[]): string | undefined {
  return [...messages].reverse().find((message) => message.timestamp)?.timestamp;
}

function sumChars(messages: CursorMessage[]): number {
  return messages.reduce((sum, message) => sum + message.text.length, 0);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function truncateEvidence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function stableEventId(...parts: string[]): string {
  const key = parts.join(":");
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash.toString(16).padStart(8, "0");
}
