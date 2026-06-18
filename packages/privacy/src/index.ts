import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { CollectorRun, CursorConversation, CursorMessage, GitChangedFile, WorkflowEvent } from "@awo/schema";

export type TextMode = "raw" | "redacted" | "hash";
export type PathMode = "raw" | "basename" | "hash";

export interface PrivacyConfig {
  textMode: TextMode;
  pathMode: PathMode;
  includeRawMessages: boolean;
}

export const DEFAULT_PRIVACY_CONFIG: PrivacyConfig = {
  textMode: "raw",
  pathMode: "raw",
  includeRawMessages: true
};

export interface PrivacySummary {
  textMode: TextMode;
  pathMode: PathMode;
  includeRawMessages: boolean;
  rawMessagesRemoved: boolean;
  note: string;
}

export function applyPrivacyToCollectorRun(run: CollectorRun, config: PrivacyConfig): CollectorRun {
  const cloned = structuredClone(run) as CollectorRun;

  cloned.cursor = {
    ...cloned.cursor,
    detectedRoots: cloned.cursor.detectedRoots.map((path) => transformPath(path, config.pathMode)),
    storageCandidates: cloned.cursor.storageCandidates.map((candidate) => ({
      ...candidate,
      path: transformPath(candidate.path, config.pathMode)
    })),
    conversations: config.includeRawMessages
      ? cloned.cursor.conversations.map((conversation) => sanitizeConversation(conversation, config))
      : []
  };

  cloned.git = {
    ...cloned.git,
    repoPath: transformPath(cloned.git.repoPath, config.pathMode),
    root: cloned.git.root ? transformPath(cloned.git.root, config.pathMode) : undefined,
    changedFiles: cloned.git.changedFiles.map((file) => sanitizeGitChangedFile(file, config))
  };

  cloned.events = cloned.events.map((event) => sanitizeEvent(event, config));
  cloned.tasks = cloned.tasks.map((task) => ({
    ...task,
    title: task.title ? transformText(task.title, config.textMode) : undefined,
    turns: task.turns.map((turn) => ({
      ...turn,
      text: transformText(turn.text, config.textMode)
    }))
  }));
  cloned.evaluations = cloned.evaluations.map((evaluation) => ({
    ...evaluation,
    corrections: evaluation.corrections.map((correction) => ({
      ...correction,
      evidence: transformText(correction.evidence, config.textMode)
    })),
    frictionEvents: evaluation.frictionEvents.map((friction) => ({
      ...friction,
      evidence: transformText(friction.evidence, config.textMode)
    }))
  }));

  return cloned;
}

export function createPrivacySummary(config: PrivacyConfig): PrivacySummary {
  return {
    textMode: config.textMode,
    pathMode: config.pathMode,
    includeRawMessages: config.includeRawMessages,
    rawMessagesRemoved: !config.includeRawMessages,
    note: "Privacy is applied after local evaluation. Hash mode preserves deterministic grouping but not original content."
  };
}

export function transformText(value: string, mode: TextMode): string {
  if (mode === "raw") return value;
  if (mode === "redacted") return `[redacted:${value.length}]`;
  return `[sha256:${sha256(value)}:len=${value.length}]`;
}

export function transformPath(value: string, mode: PathMode): string {
  if (mode === "raw") return value;
  if (mode === "basename") return basename(value);
  return `[path-sha256:${sha256(value)}]`;
}

function sanitizeConversation(conversation: CursorConversation, config: PrivacyConfig): CursorConversation {
  return {
    ...conversation,
    title: conversation.title ? transformText(conversation.title, config.textMode) : undefined,
    rawSource: conversation.rawSource ? transformPath(conversation.rawSource, config.pathMode) : undefined,
    messages: conversation.messages.map((message) => sanitizeMessage(message, config))
  };
}

function sanitizeMessage(message: CursorMessage, config: PrivacyConfig): CursorMessage {
  return {
    ...message,
    text: transformText(message.text, config.textMode)
  };
}

function sanitizeGitChangedFile(file: GitChangedFile, config: PrivacyConfig): GitChangedFile {
  return {
    ...file,
    path: transformPath(file.path, config.pathMode)
  };
}

function sanitizeEvent(event: WorkflowEvent, config: PrivacyConfig): WorkflowEvent {
  return {
    ...event,
    payload: sanitizePayload(event.payload, config)
  };
}

function sanitizePayload(value: Record<string, unknown>, config: PrivacyConfig): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      output[key] = shouldTreatAsPath(key) ? transformPath(item, config.pathMode) : transformText(item, config.textMode);
      continue;
    }
    output[key] = sanitizeUnknown(item, config);
  }

  return output;
}

function sanitizeUnknown(value: unknown, config: PrivacyConfig): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, config));
  if (value && typeof value === "object") return sanitizePayload(value as Record<string, unknown>, config);
  return value;
}

function shouldTreatAsPath(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("path") || normalized.includes("source") || normalized.includes("repo") || normalized.includes("root");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
