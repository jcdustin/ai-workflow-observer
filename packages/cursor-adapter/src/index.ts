import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  CursorConversation,
  CursorMessage,
  CursorObservation,
  ObservabilityLevel,
  StorageCandidate
} from "@awo/schema";

export const CURSOR_ADAPTER_VERSION = "0.1.0";
const execFileAsync = promisify(execFile);

export interface SqliteReader {
  readCursorConversations(databasePath: string): Promise<CursorConversation[]>;
}

export interface CursorAdapterOptions {
  homeDir?: string;
  extraRoots?: string[];
  sqliteReader?: SqliteReader;
  maxDepth?: number;
}

export interface SqliteCliReaderOptions {
  command?: string;
  timeoutMs?: number;
}

export interface PythonSqliteReaderOptions {
  command?: string;
  timeoutMs?: number;
}

export async function collectCursorObservation(options: CursorAdapterOptions = {}): Promise<CursorObservation> {
  const warnings: string[] = [];
  const home = options.homeDir ?? homedir();
  const roots = await detectCursorRoots(home, options.extraRoots ?? []);
  const storageCandidates = await findStorageCandidates(roots, options.maxDepth ?? 7);
  const sqliteCandidates = storageCandidates.filter((candidate) => candidate.readable && candidate.kind === "sqlite");
  const conversations: CursorConversation[] = [];

  if (options.sqliteReader) {
    for (const candidate of sqliteCandidates) {
      try {
        const candidateConversations = await options.sqliteReader.readCursorConversations(candidate.path);
        conversations.push(
          ...candidateConversations.map((conversation) => ({
            ...conversation,
            rawSource: conversation.rawSource ?? candidate.path
          }))
        );
      } catch (error) {
        warnings.push(`Unable to read Cursor SQLite candidate ${candidate.path}: ${summarizeError(error)}`);
      }
    }
  } else if (sqliteCandidates.length > 0) {
    warnings.push("SQLite candidates were found, but no SqliteReader was configured.");
  }

  return {
    source: "cursor",
    adapterVersion: CURSOR_ADAPTER_VERSION,
    platform: platform(),
    observabilityLevel: inferObservabilityLevel(storageCandidates, conversations, Boolean(options.sqliteReader)),
    detectedRoots: roots,
    storageCandidates,
    conversations,
    warnings
  };
}

export async function detectCursorRoots(home: string, extraRoots: string[] = []): Promise<string[]> {
  const candidates = [
    ...extraRoots,
    join(home, ".config", "Cursor"),
    join(home, ".cursor"),
    join(home, ".cursor-server"),
    join(home, "AppData", "Roaming", "Cursor"),
    join(home, "Library", "Application Support", "Cursor")
  ];

  const roots = new Set<string>();

  for (const candidate of candidates) {
    if (await isReadableDirectory(candidate)) {
      roots.add(candidate);
    }
  }

  if (await isReadableDirectory("/mnt/c/Users")) {
    const users = await readdir("/mnt/c/Users", { withFileTypes: true }).catch(() => []);
    for (const user of users) {
      if (!user.isDirectory()) continue;
      const userRoot = join("/mnt/c/Users", user.name, "AppData", "Roaming", "Cursor");
      if (await isReadableDirectory(userRoot)) {
        roots.add(userRoot);
      }
    }
  }

  return [...roots];
}

async function findStorageCandidates(roots: string[], maxDepth: number): Promise<StorageCandidate[]> {
  const candidates: StorageCandidate[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    await walk(root, 0);
  }

  return candidates.sort((a, b) => a.path.localeCompare(b.path));

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (seen.has(currentPath) || depth > maxDepth) return;
    seen.add(currentPath);

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (isLikelyStorageDirectory(entry.name)) {
          candidates.push(await toStorageCandidate(entryPath, "directory"));
        }
        await walk(entryPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      const kind = classifyStorageFile(entry.name);
      if (kind !== "unknown") {
        candidates.push(await toStorageCandidate(entryPath, kind));
      }
    }
  }
}

async function isReadableDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) return false;
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isLikelyStorageDirectory(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "globalstorage" || normalized === "workspacestorage";
}

function classifyStorageFile(name: string): StorageCandidate["kind"] {
  const normalized = name.toLowerCase();
  if (normalized.endsWith(".vscdb") || normalized.endsWith(".sqlite") || normalized.endsWith(".sqlite3") || normalized.endsWith(".db")) {
    return "sqlite";
  }
  if (normalized === "storage.json" || normalized === "argv.json") {
    return "json";
  }
  return "unknown";
}

async function toStorageCandidate(path: string, kind: StorageCandidate["kind"]): Promise<StorageCandidate> {
  try {
    const info = await stat(path);
    await access(path, constants.R_OK);
    return {
      path,
      kind,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      readable: true
    };
  } catch (error) {
    return {
      path,
      kind,
      readable: false,
      reason: String(error)
    };
  }
}

function inferObservabilityLevel(
  candidates: StorageCandidate[],
  conversations: CursorConversation[],
  hasSqliteReader: boolean
): ObservabilityLevel {
  if (conversations.length > 0) return "partial";
  if (hasSqliteReader && candidates.some((candidate) => candidate.kind === "sqlite" && candidate.readable)) return "minimal";
  if (candidates.length > 0) return "minimal";
  return "none";
}

export function normalizeMessageRole(value: unknown): CursorMessage["role"] {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  return "unknown";
}

export function createSqliteCliReader(options: SqliteCliReaderOptions = {}): SqliteReader {
  const command = options.command ?? "sqlite3";
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async readCursorConversations(databasePath: string): Promise<CursorConversation[]> {
      const sql =
        "select key, value from ItemTable where lower(key) like '%composer%' or lower(key) like '%chat%' or lower(key) like '%conversation%' union all select key, value from cursorDiskKV where key like 'composerData:%' or key like 'bubbleId:%' limit 1000;";

      const result = await execFileAsync(command, ["-json", databasePath, sql], {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 10
      });

      const rows = parseSqliteJsonRows(result.stdout);
      const conversations: CursorConversation[] = [];

      for (const row of rows) {
        const extracted = extractConversationsFromUnknownJson(row.key, row.value, databasePath);
        conversations.push(...extracted);
      }

      return conversations;
    }
  };
}

export function createPythonSqliteReader(options: PythonSqliteReaderOptions = {}): SqliteReader {
  const command = options.command ?? "python3";
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async readCursorConversations(databasePath: string): Promise<CursorConversation[]> {
      const result = await execFileAsync(command, ["-c", PYTHON_CURSOR_SQLITE_READER, databasePath], {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 20
      });
      const parsed = JSON.parse(result.stdout) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap(fromUnknownConversation);
    }
  };
}

function parseSqliteJsonRows(stdout: string): Array<{ key: string; value: string }> {
  if (!stdout.trim()) return [];

  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((row) => {
    if (!isRecord(row) || typeof row.key !== "string" || typeof row.value !== "string") return [];
    return [{ key: row.key, value: row.value }];
  });
}

function extractConversationsFromUnknownJson(key: string, value: string, rawSource: string): CursorConversation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  const messageArrays = findMessageArrays(parsed);
  const conversations = messageArrays.map((messages, index) => ({
    conversationId: shaLikeId(`${rawSource}:${key}:${index}`),
    title: key,
    messages,
    rawSource
  }));

  if (conversations.length > 0) return conversations;

  if (key.startsWith("composerData:") && isRecord(parsed)) {
    const messages = extractMessagesFromComposerData(parsed);
    if (messages.length > 0) {
      return [
        {
          conversationId: String(parsed.composerId ?? key.replace("composerData:", "")),
          title: typeof parsed.name === "string" ? parsed.name : key,
          startedAt: epochMsToIso(parsed.createdAt),
          updatedAt: epochMsToIso(parsed.lastUpdatedAt ?? parsed.updatedAt),
          status: normalizeConversationStatus(parsed.status),
          messages,
          rawSource
        }
      ];
    }
  }

  return conversations;
}

function extractMessagesFromComposerData(value: Record<string, unknown>): CursorMessage[] {
  const conversation = value.conversation;
  if (Array.isArray(conversation)) {
    return conversation.map(toCursorMessage).filter((message): message is CursorMessage => Boolean(message));
  }

  const headers = value.fullConversationHeadersOnly;
  const map = value.conversationMap;
  if (!Array.isArray(headers) || !isRecord(map)) return [];

  return headers.flatMap((header) => {
    if (!isRecord(header) || typeof header.bubbleId !== "string") return [];
    const bubble = map[header.bubbleId];
    const message = toCursorMessageFromBubble(bubble, header.bubbleId);
    return message ? [message] : [];
  });
}

function findMessageArrays(value: unknown): CursorMessage[][] {
  const found: CursorMessage[][] = [];
  const seen = new Set<unknown>();

  visit(value);
  return found;

  function visit(current: unknown): void {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      const messages = current.map(toCursorMessage).filter((message): message is CursorMessage => Boolean(message));
      if (messages.length >= 2 && messages.some((message) => message.role === "user") && messages.some((message) => message.role === "assistant")) {
        found.push(messages);
      }
      for (const item of current) visit(item);
      return;
    }

    for (const item of Object.values(current)) {
      visit(item);
    }
  }
}

function toCursorMessage(value: unknown): CursorMessage | undefined {
  if (!isRecord(value)) return undefined;

  const text = firstString(value.text, value.content, value.message, value.markdown, value.value);
  if (!text) return undefined;

  return {
    messageId: firstString(value.id, value.messageId, value.uuid) ?? shaLikeId(text),
    role: normalizeMessageRole(value.role ?? value.type ?? value.sender),
    text,
    timestamp: firstString(value.timestamp, value.createdAt, value.time)
  };
}

function toCursorMessageFromBubble(value: unknown, fallbackId: string): CursorMessage | undefined {
  if (!isRecord(value)) return undefined;
  const text = firstString(value.text, value.content, value.markdown, value.richText);
  if (!text) return undefined;
  return {
    messageId: firstString(value.bubbleId, value.id) ?? fallbackId,
    role: roleFromCursorBubbleType(value.type),
    text,
    timestamp: epochMsToIso(value.createdAt ?? value.timestamp)
  };
}

function roleFromCursorBubbleType(value: unknown): CursorMessage["role"] {
  if (value === 1) return "user";
  if (value === 2) return "assistant";
  return normalizeMessageRole(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function epochMsToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function fromUnknownConversation(value: unknown): CursorConversation[] {
  if (!isRecord(value) || typeof value.conversationId !== "string") return [];
  const messages = Array.isArray(value.messages)
    ? value.messages.flatMap((message) => {
        if (!isRecord(message) || typeof message.text !== "string" || typeof message.messageId !== "string") return [];
        return [
          {
            messageId: message.messageId,
            role: normalizeMessageRole(message.role),
            text: message.text,
            timestamp: typeof message.timestamp === "string" ? message.timestamp : undefined
          }
        ];
      })
    : [];
  if (messages.length === 0) return [];
  return [
    {
      conversationId: value.conversationId,
      workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : undefined,
      title: typeof value.title === "string" ? value.title : undefined,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
      status: normalizeConversationStatus(value.status),
      messages,
      rawSource: typeof value.rawSource === "string" ? value.rawSource : undefined
    }
  ];
}

function normalizeConversationStatus(value: unknown): CursorConversation["status"] {
  if (value === "completed" || value === "aborted" || value === "generating") return value;
  return "unknown";
}

function shaLikeId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    const stderr = "stderr" in error ? (error as { stderr?: unknown }).stderr : undefined;
    if (typeof stderr === "string" && stderr.trim()) {
      const lines = stderr.trim().split("\n").filter(Boolean);
      return lines[lines.length - 1] ?? stderr.trim();
    }
    const message = error.message.split("\n")[0] ?? error.message;
    return `${error.name}: ${message}`;
  }
  return String(error).split("\n")[0] ?? String(error);
}

const PYTHON_CURSOR_SQLITE_READER = String.raw`
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

db = sys.argv[1]

def decode(value):
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value

def iso(value):
    if not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return None

def role_from_type(value):
    if value == 1:
        return "user"
    if value == 2:
        return "assistant"
    return "unknown"

def text_from_bubble(bubble):
    for key in ("text", "content", "markdown", "richText"):
        value = bubble.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None

def message_from_bubble(bubble, fallback_id):
    if not isinstance(bubble, dict):
        return None
    text = text_from_bubble(bubble)
    if not text:
        return None
    return {
        "messageId": bubble.get("bubbleId") or bubble.get("id") or fallback_id,
        "role": role_from_type(bubble.get("type")),
        "text": text,
        "timestamp": iso(bubble.get("createdAt") or bubble.get("timestamp"))
    }

def read_json(con, table, key):
    row = con.execute(f"select value from {table} where key=?", (key,)).fetchone()
    if not row:
        return None
    value = decode(row[0])
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None

def table_exists(con, table):
    return con.execute("select 1 from sqlite_master where type='table' and name=?", (table,)).fetchone() is not None

out = []

with tempfile.TemporaryDirectory(prefix="awo-cursor-sqlite-") as tmpdir:
    snapshot = os.path.join(tmpdir, os.path.basename(db))
    shutil.copy2(db, snapshot)
    for suffix in ("-wal", "-shm"):
        sidecar = db + suffix
        if os.path.exists(sidecar):
            shutil.copy2(sidecar, snapshot + suffix)

    con = sqlite3.connect("file:" + snapshot + "?mode=ro", uri=True)

    if table_exists(con, "cursorDiskKV"):
        for key, value in con.execute("select key, value from cursorDiskKV where key like 'composerData:%'"):
            text = decode(value)
            if not text:
                continue
            try:
                composer = json.loads(text)
            except Exception:
                continue
            if not isinstance(composer, dict):
                continue

            composer_id = composer.get("composerId") or key.replace("composerData:", "")
            messages = []

            conversation = composer.get("conversation")
            if isinstance(conversation, list):
                for item in conversation:
                    msg = message_from_bubble(item, str(len(messages))) if isinstance(item, dict) else None
                    if msg:
                        messages.append(msg)

            headers = composer.get("fullConversationHeadersOnly")
            if isinstance(headers, list):
                for header in headers:
                    if not isinstance(header, dict):
                        continue
                    bubble_id = header.get("bubbleId")
                    if not isinstance(bubble_id, str):
                        continue
                    bubble = read_json(con, "cursorDiskKV", "bubbleId:" + composer_id + ":" + bubble_id)
                    msg = message_from_bubble(bubble, bubble_id)
                    if msg:
                        messages.append(msg)

            if messages:
                out.append({
                    "conversationId": composer_id,
                    "title": composer.get("name") or key,
                    "startedAt": iso(composer.get("createdAt")),
                    "updatedAt": iso(composer.get("lastUpdatedAt") or composer.get("updatedAt")),
                    "status": composer.get("status") if composer.get("status") in ("completed", "aborted", "generating") else "unknown",
                    "messages": messages,
                    "rawSource": db
                })

print(json.dumps(out))
`;
