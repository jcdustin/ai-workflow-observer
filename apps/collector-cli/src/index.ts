#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { hostname, platform, arch, homedir } from "node:os";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { collectCursorObservation, createPythonSqliteReader, createSqliteCliReader } from "@awo/cursor-adapter";
import { evaluateCursorConversations } from "@awo/evaluator";
import { collectGitObservation } from "@awo/git-adapter";
import {
  applyPrivacyToCollectorRun,
  createPrivacySummary,
  type PathMode,
  type PrivacyConfig,
  type TextMode
} from "@awo/privacy";
import { createEvent, type CollectorRun, type RunContext, type SourceTool } from "@awo/schema";

interface CliOptions {
  repo: string;
  output?: string;
  pretty: boolean;
  includeHostnameHash: boolean;
  memberId?: string;
  cursorRoot: string[];
  sqliteCommand?: string;
  pythonSqliteCommand?: string;
  uploadUrl?: string;
  departmentKey?: string;
  textMode: TextMode;
  pathMode: PathMode;
  includeRawMessages: boolean;
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
  help: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const generatedAt = new Date().toISOString();
  const runId = randomUUID();
  const repoPath = resolve(options.repo);
  const memberIdHash = options.memberId ? sha256(options.memberId) : undefined;
  const context = createRunContext(options);

  const [cursor, git] = await Promise.all([
    collectCursorObservation({
      homeDir: homedir(),
      extraRoots: options.cursorRoot,
      sqliteReader: options.pythonSqliteCommand
        ? createPythonSqliteReader({ command: options.pythonSqliteCommand })
        : options.sqliteCommand
          ? createSqliteCliReader({ command: options.sqliteCommand })
          : undefined
    }),
    collectGitObservation(repoPath)
  ]);
  const evaluated = evaluateCursorConversations(cursor.conversations, generatedAt, context);
  const collectorRunEvent = createEvent({
    id: randomUUID(),
    source: "cursor",
    eventType: "collector_run",
    timestamp: generatedAt,
    payload: {
      runId,
      sourceTool: context.sourceTool,
      toolVersion: context.toolVersion,
      modelName: context.modelName,
      modelVersion: context.modelVersion,
      modelProvider: context.modelProvider,
      teamId: context.teamId,
      repoId: context.repoId,
      experimentId: context.experimentId,
      migrationCohort: context.migrationCohort,
      collectorVersion: context.collectorVersion,
      cursorObservabilityLevel: cursor.observabilityLevel,
      cursorStorageCandidateCount: cursor.storageCandidates.length,
      cursorConversationCount: cursor.conversations.length,
      taskCount: evaluated.tasks.length,
      correctionCount: evaluated.metrics.correctionCount,
      frictionEventCount: evaluated.metrics.frictionEventCount,
      gitIsRepo: git.isRepo,
      gitChangedFileCount: git.changedFiles.length
    }
  });

  const privacy: PrivacyConfig = {
    textMode: options.textMode,
    pathMode: options.pathMode,
    includeRawMessages: options.includeRawMessages
  };

  const run: CollectorRun = {
    schemaVersion: "0.1",
    runId,
    generatedAt,
    context,
    host: {
      platform: platform(),
      arch: arch(),
      hostnameHash: options.includeHostnameHash ? sha256(hostname()) : undefined
    },
    memberIdHash,
    privacy: createPrivacySummary(privacy),
    cursor,
    git,
    events: [collectorRunEvent, ...evaluated.events],
    tasks: evaluated.tasks,
    evaluations: evaluated.evaluations,
    metrics: evaluated.metrics
  };

  const outputRun = applyPrivacyToCollectorRun(run, privacy);
  const json = JSON.stringify(outputRun, null, options.pretty ? 2 : 0);

  if (options.output) {
    await writeFile(resolve(options.output), `${json}\n`, "utf8");
  }

  if (options.uploadUrl) {
    const response = await uploadCollectorRun(options.uploadUrl, json, options.departmentKey);
    process.stderr.write(`Uploaded collector run: ${JSON.stringify(response)}\n`);
  }

  if (!options.output) {
    process.stdout.write(`${json}\n`);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    repo: process.cwd(),
    pretty: false,
    includeHostnameHash: false,
    cursorRoot: [],
    textMode: parseTextMode(process.env.AWO_TEXT_MODE ?? "raw"),
    pathMode: parsePathMode(process.env.AWO_PATH_MODE ?? "raw"),
    includeRawMessages: parseBoolean(process.env.AWO_INCLUDE_RAW_MESSAGES, true),
    sourceTool: parseSourceTool(process.env.AWO_SOURCE_TOOL ?? "cursor"),
    toolVersion: process.env.AWO_TOOL_VERSION,
    modelName: process.env.AWO_MODEL_NAME,
    modelVersion: process.env.AWO_MODEL_VERSION,
    modelProvider: process.env.AWO_MODEL_PROVIDER,
    teamId: process.env.AWO_TEAM_ID,
    repoId: process.env.AWO_REPO_ID,
    experimentId: process.env.AWO_EXPERIMENT_ID,
    migrationCohort: process.env.AWO_MIGRATION_COHORT,
    collectorVersion: process.env.AWO_COLLECTOR_VERSION ?? "0.1.0",
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--") {
      continue;
    }

    switch (arg) {
      case "--repo":
        requireValue(arg, next);
        options.repo = next;
        index += 1;
        break;
      case "--output":
      case "-o":
        requireValue(arg, next);
        options.output = next;
        index += 1;
        break;
      case "--member-id":
        requireValue(arg, next);
        options.memberId = next;
        index += 1;
        break;
      case "--cursor-root":
        requireValue(arg, next);
        options.cursorRoot.push(resolve(next));
        index += 1;
        break;
      case "--sqlite-command":
        requireValue(arg, next);
        options.sqliteCommand = next;
        index += 1;
        break;
      case "--python-sqlite-command":
        requireValue(arg, next);
        options.pythonSqliteCommand = next;
        index += 1;
        break;
      case "--upload-url":
        requireValue(arg, next);
        options.uploadUrl = next;
        index += 1;
        break;
      case "--department-key":
        requireValue(arg, next);
        options.departmentKey = next;
        index += 1;
        break;
      case "--text-mode":
        requireValue(arg, next);
        options.textMode = parseTextMode(next);
        index += 1;
        break;
      case "--path-mode":
        requireValue(arg, next);
        options.pathMode = parsePathMode(next);
        index += 1;
        break;
      case "--include-raw-messages":
        options.includeRawMessages = true;
        break;
      case "--no-raw-messages":
        options.includeRawMessages = false;
        break;
      case "--source-tool":
        requireValue(arg, next);
        options.sourceTool = parseSourceTool(next);
        index += 1;
        break;
      case "--tool-version":
        requireValue(arg, next);
        options.toolVersion = next;
        index += 1;
        break;
      case "--model-name":
        requireValue(arg, next);
        options.modelName = next;
        index += 1;
        break;
      case "--model-version":
        requireValue(arg, next);
        options.modelVersion = next;
        index += 1;
        break;
      case "--model-provider":
        requireValue(arg, next);
        options.modelProvider = next;
        index += 1;
        break;
      case "--team-id":
        requireValue(arg, next);
        options.teamId = next;
        index += 1;
        break;
      case "--repo-id":
        requireValue(arg, next);
        options.repoId = next;
        index += 1;
        break;
      case "--experiment-id":
        requireValue(arg, next);
        options.experimentId = next;
        index += 1;
        break;
      case "--migration-cohort":
        requireValue(arg, next);
        options.migrationCohort = next;
        index += 1;
        break;
      case "--include-hostname-hash":
        options.includeHostnameHash = true;
        break;
      case "--pretty":
        options.pretty = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(arg: string, value: string | undefined): asserts value is string {
  if (!value || value.startsWith("-")) {
    throw new Error(`${arg} requires a value.`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseTextMode(value: string): TextMode {
  if (value === "raw" || value === "redacted" || value === "hash") return value;
  throw new Error(`Invalid text mode: ${value}. Expected raw, redacted, or hash.`);
}

function parsePathMode(value: string): PathMode {
  if (value === "raw" || value === "basename" || value === "hash") return value;
  throw new Error(`Invalid path mode: ${value}. Expected raw, basename, or hash.`);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

function parseSourceTool(value: string): SourceTool {
  if (value === "cursor" || value === "opencode" || value === "copilot" || value === "unknown") return value;
  throw new Error(`Invalid source tool: ${value}. Expected cursor, opencode, copilot, or unknown.`);
}

function createRunContext(options: CliOptions): RunContext {
  return compactObject({
    sourceTool: options.sourceTool,
    toolVersion: options.toolVersion,
    modelName: options.modelName,
    modelVersion: options.modelVersion,
    modelProvider: options.modelProvider,
    teamId: options.teamId,
    repoId: options.repoId,
    experimentId: options.experimentId,
    migrationCohort: options.migrationCohort,
    collectorVersion: options.collectorVersion
  }) as RunContext;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as Partial<T>;
}

async function uploadCollectorRun(
  uploadUrl: string,
  json: string,
  departmentKey: string | undefined
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (departmentKey) {
    headers["x-awo-department-key"] = departmentKey;
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers,
    body: json
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new Error(`Upload failed with HTTP ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }

  return parsed;
}

function helpText(): string {
  return `AI Workflow Observer collector

Usage:
  awo-collector [options]

Options:
  --repo <path>                  Repository path to inspect. Defaults to cwd.
  --cursor-root <path>           Extra Cursor storage root to scan. Repeatable.
  --sqlite-command <command>     Optional sqlite3-compatible command for Cursor conversation extraction.
  --python-sqlite-command <cmd>  Optional Python command using stdlib sqlite3 for Cursor extraction.
  --upload-url <url>             Optional ingestion endpoint for direct upload.
  --department-key <key>         Department ingestion key sent as x-awo-department-key.
  --text-mode <mode>             raw, redacted, or hash. Defaults to AWO_TEXT_MODE or raw.
  --path-mode <mode>             raw, basename, or hash. Defaults to AWO_PATH_MODE or raw.
  --include-raw-messages         Include raw Cursor conversations in output.
  --no-raw-messages              Remove raw Cursor conversations after local evaluation.
  --source-tool <tool>           cursor, opencode, copilot, or unknown. Defaults to cursor.
  --tool-version <version>       AI tool version for cohort analysis.
  --model-provider <provider>    Model provider, for example openai, anthropic, inhouse.
  --model-name <name>            Model name used by the AI tool if known.
  --model-version <version>      Model version or deployment id if known.
  --team-id <id>                 Optional team id for BI grouping.
  --repo-id <id>                 Optional repository id for BI grouping.
  --experiment-id <id>           Optional experiment or rollout id.
  --migration-cohort <name>      Optional cohort label, for example cursor-baseline or opencode-pilot.
  --member-id <value>            Optional member identifier. Stored as SHA-256.
  --include-hostname-hash        Include SHA-256 hostname hash.
  -o, --output <path>            Write JSON report to a file instead of stdout.
  --pretty                      Pretty-print JSON output.
  -h, --help                     Show help.
`;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
