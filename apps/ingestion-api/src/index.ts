#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CollectorRun } from "@awo/schema";

const port = Number(process.env.PORT ?? 3010);
const host = process.env.HOST ?? "127.0.0.1";
const dataDir = resolve(process.env.AWO_DATA_DIR ?? "data");
const maxBodyBytes = Number(process.env.AWO_MAX_BODY_BYTES ?? 25 * 1024 * 1024);
const departmentKeys = parseDepartmentKeys(process.env.AWO_DEPARTMENT_KEYS);

async function main(): Promise<void> {
  await mkdir(dataDir, { recursive: true });

  const server = createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, host, () => {
    process.stdout.write(`AI Workflow Observer ingestion API listening on http://${host}:${port}\n`);
  });
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/collector-runs") {
    const identity = authenticateDepartment(request);
    if (!identity.ok) {
      sendJson(response, 401, { error: "unauthorized", message: identity.message });
      return;
    }

    const body = await readBody(request);
    const parsed = JSON.parse(body) as unknown;
    const validation = validateCollectorRun(parsed);

    if (!validation.ok) {
      sendJson(response, 400, { error: "invalid_collector_run", message: validation.message });
      return;
    }

    const run = parsed as CollectorRun;
    run.departmentId = identity.departmentId;
    run.collectorIdentity = {
      departmentId: identity.departmentId,
      keyId: identity.keyId
    };

    const line = JSON.stringify({
      receivedAt: new Date().toISOString(),
      run
    });
    await appendFile(resolve(dataDir, "collector-runs.jsonl"), `${line}\n`, "utf8");

    sendJson(response, 202, {
      accepted: true,
      runId: run.runId,
      departmentId: run.departmentId,
      taskCount: run.tasks.length,
      eventCount: run.events.length,
      evaluationCount: run.evaluations.length
    });
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function authenticateDepartment(request: IncomingMessage):
  | { ok: true; departmentId: string; keyId: string }
  | { ok: false; message: string } {
  if (departmentKeys.length === 0) {
    return { ok: false, message: "No department keys are configured on the ingestion API." };
  }

  const key = readDepartmentKey(request);
  if (!key) {
    return { ok: false, message: "Missing x-awo-department-key or Bearer token." };
  }

  const matched = departmentKeys.find((candidate) => candidate.key === key);
  if (!matched) {
    return { ok: false, message: "Invalid department key." };
  }

  return { ok: true, departmentId: matched.departmentId, keyId: matched.keyId };
}

function readDepartmentKey(request: IncomingMessage): string | undefined {
  const direct = request.headers["x-awo-department-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const auth = request.headers.authorization;
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  return undefined;
}

interface DepartmentKey {
  departmentId: string;
  keyId: string;
  key: string;
}

function parseDepartmentKeys(raw: string | undefined): DepartmentKey[] {
  if (!raw?.trim()) return [];

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("AWO_DEPARTMENT_KEYS JSON must be an object.");
    }

    return Object.entries(parsed).map(([departmentId, value]) => {
      if (typeof value === "string") {
        return { departmentId, keyId: departmentId, key: value };
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (typeof record.key !== "string") {
          throw new Error(`AWO_DEPARTMENT_KEYS.${departmentId}.key must be a string.`);
        }
        return {
          departmentId,
          keyId: typeof record.keyId === "string" ? record.keyId : departmentId,
          key: record.key
        };
      }
      throw new Error(`AWO_DEPARTMENT_KEYS.${departmentId} must be a string or object.`);
    });
  }

  return trimmed.split(",").flatMap((entry) => {
    const [departmentId, key, keyId] = entry.split(":").map((part) => part.trim());
    if (!departmentId || !key) return [];
    return [{ departmentId, key, keyId: keyId || departmentId }];
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) {
      throw new Error(`Request body exceeds ${maxBodyBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function validateCollectorRun(value: unknown): { ok: true } | { ok: false; message: string } {
  if (!value || typeof value !== "object") return { ok: false, message: "Body must be a JSON object." };
  const candidate = value as Partial<CollectorRun>;

  if (candidate.schemaVersion !== "0.1") return { ok: false, message: "Unsupported schemaVersion." };
  if (typeof candidate.runId !== "string" || !candidate.runId) return { ok: false, message: "Missing runId." };
  if (typeof candidate.generatedAt !== "string" || !candidate.generatedAt) return { ok: false, message: "Missing generatedAt." };
  if (!Array.isArray(candidate.events)) return { ok: false, message: "Missing events array." };
  if (!Array.isArray(candidate.tasks)) return { ok: false, message: "Missing tasks array." };
  if (!Array.isArray(candidate.evaluations)) return { ok: false, message: "Missing evaluations array." };
  if (!candidate.metrics || typeof candidate.metrics !== "object") return { ok: false, message: "Missing metrics object." };

  return { ok: true };
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
