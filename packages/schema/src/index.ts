export type SourceTool = "cursor" | "opencode" | "copilot" | "unknown";

export type ObservabilityLevel = "full" | "partial" | "minimal" | "none";

export type WorkflowEventType =
  | "collector_run"
  | "task_started"
  | "user_prompt"
  | "assistant_response"
  | "tool_call"
  | "file_changed"
  | "diff_applied"
  | "command_run"
  | "user_correction"
  | "task_completed"
  | "task_abandoned"
  | "evaluation_result";

export interface WorkflowEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  source: SourceTool;
  eventType: WorkflowEventType;
  timestamp: string;
  workspaceId?: string;
  taskId?: string;
  payload: TPayload;
}

export interface StorageCandidate {
  path: string;
  kind: "sqlite" | "json" | "directory" | "unknown";
  sizeBytes?: number;
  modifiedAt?: string;
  readable: boolean;
  reason?: string;
}

export interface CursorObservation {
  source: "cursor";
  adapterVersion: string;
  platform: NodeJS.Platform;
  observabilityLevel: ObservabilityLevel;
  detectedRoots: string[];
  storageCandidates: StorageCandidate[];
  conversations: CursorConversation[];
  warnings: string[];
}

export interface CursorConversation {
  conversationId: string;
  workspaceId?: string;
  title?: string;
  startedAt?: string;
  updatedAt?: string;
  status?: "completed" | "aborted" | "generating" | "unknown";
  messages: CursorMessage[];
  rawSource?: string;
}

export interface CursorMessage {
  messageId: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  timestamp?: string;
}

export interface ConversationTurn {
  turnId: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  messageIds: string[];
  text: string;
  startedAt?: string;
  endedAt?: string;
}

export interface GitObservation {
  repoPath: string;
  isRepo: boolean;
  root?: string;
  branch?: string;
  head?: string;
  changedFiles: GitChangedFile[];
  diffStat?: string;
  warnings: string[];
}

export interface GitChangedFile {
  path: string;
  status: string;
}

export interface CollectorRun {
  schemaVersion: "0.1";
  runId: string;
  generatedAt: string;
  context: RunContext;
  host: {
    platform: NodeJS.Platform;
    arch: string;
    hostnameHash?: string;
  };
  memberIdHash?: string;
  departmentId?: string;
  collectorIdentity?: {
    departmentId?: string;
    keyId?: string;
  };
  privacy?: {
    textMode: "raw" | "redacted" | "hash";
    pathMode: "raw" | "basename" | "hash";
    includeRawMessages: boolean;
    rawMessagesRemoved: boolean;
    note: string;
  };
  cursor: CursorObservation;
  git: GitObservation;
  events: WorkflowEvent[];
  tasks: TaskSummary[];
  evaluations: TaskEvaluation[];
  metrics: CollectorMetrics;
}

export interface RunContext {
  sourceTool: SourceTool;
  toolVersion?: string;
  modelName?: string;
  modelVersion?: string;
  modelProvider?: string;
  teamId?: string;
  repoId?: string;
  experimentId?: string;
  migrationCohort?: string;
  collectorVersion?: string;
}

export type TaskOutcome = "completed" | "abandoned" | "unknown";

export type TaskType =
  | "bugfix"
  | "feature"
  | "refactor"
  | "test_generation"
  | "documentation"
  | "code_review"
  | "code_explanation"
  | "debugging"
  | "planning"
  | "general";

export type TaskComplexity = "small" | "medium" | "large";

export interface TaskSummary {
  taskId: string;
  source: SourceTool;
  context?: RunContext;
  sourceConversationId?: string;
  title?: string;
  taskType: TaskType;
  complexity: TaskComplexity;
  outcome: TaskOutcome;
  startedAt?: string;
  endedAt?: string;
  messageCount: number;
  turnCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  userTurnCount: number;
  assistantTurnCount: number;
  userInputChars: number;
  assistantOutputChars: number;
  turns: ConversationTurn[];
  correctionCount: number;
  frictionEventCount: number;
}

export type CorrectionType =
  | "clarification"
  | "preference_adjustment"
  | "scope_change"
  | "error_correction"
  | "misinterpretation"
  | "missed_requirement"
  | "execution_failure"
  | "quality_feedback";

export type Severity = "low" | "medium" | "high";

export interface CorrectionEvent {
  eventId: string;
  messageId: string;
  type: CorrectionType;
  severity: Severity;
  evidence: string;
}

export type FrictionType =
  | "correction"
  | "rework"
  | "tool_failure"
  | "long_iteration"
  | "abandonment"
  | "low_signal_exchange";

export interface FrictionEvent {
  eventId: string;
  type: FrictionType;
  severity: Severity;
  evidence: string;
}

export interface TaskEvaluation {
  taskId: string;
  source: SourceTool;
  evaluatedAt: string;
  evaluator: "heuristic-v0";
  taskType: TaskType;
  complexity: TaskComplexity;
  outcome: TaskOutcome;
  corrections: CorrectionEvent[];
  frictionEvents: FrictionEvent[];
  confidence: number;
  notes: string[];
}

export interface CollectorMetrics {
  taskCount: number;
  conversationCount: number;
  messageCount: number;
  correctionCount: number;
  frictionEventCount: number;
  completionRate: number | null;
  averageCorrectionsPerTask: number | null;
  averageTurnsPerTask: number | null;
  averageUserTurnsPerTask: number | null;
  averageAssistantTurnsPerTask: number | null;
  averageUserMessagesPerTask: number | null;
  averageAssistantMessagesPerTask: number | null;
}

export function createEvent<TPayload extends Record<string, unknown>>(args: {
  id: string;
  source: SourceTool;
  eventType: WorkflowEventType;
  timestamp: string;
  workspaceId?: string;
  taskId?: string;
  payload: TPayload;
}): WorkflowEvent<TPayload> {
  return {
    id: args.id,
    source: args.source,
    eventType: args.eventType,
    timestamp: args.timestamp,
    workspaceId: args.workspaceId,
    taskId: args.taskId,
    payload: args.payload
  };
}
