import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitChangedFile, GitObservation } from "@awo/schema";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    timeout: 10_000,
    maxBuffer: 1024 * 1024 * 5
  });
  return result.stdout.trim();
}

export async function collectGitObservation(repoPath: string): Promise<GitObservation> {
  const warnings: string[] = [];

  try {
    const root = await git(["rev-parse", "--show-toplevel"], repoPath);
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root).catch((error: unknown) => {
      warnings.push(`Unable to read branch: ${String(error)}`);
      return undefined;
    });
    const head = await git(["rev-parse", "HEAD"], root).catch((error: unknown) => {
      warnings.push(`Unable to read HEAD: ${String(error)}`);
      return undefined;
    });
    const porcelain = await git(["status", "--porcelain=v1"], root).catch((error: unknown) => {
      warnings.push(`Unable to read git status: ${String(error)}`);
      return "";
    });
    const diffStat = await git(["diff", "--stat"], root).catch((error: unknown) => {
      warnings.push(`Unable to read diff stat: ${String(error)}`);
      return undefined;
    });

    return {
      repoPath,
      isRepo: true,
      root,
      branch,
      head,
      changedFiles: parsePorcelain(porcelain),
      diffStat,
      warnings
    };
  } catch (error) {
    return {
      repoPath,
      isRepo: false,
      changedFiles: [],
      warnings: [`Not a git repository or git unavailable: ${String(error)}`]
    };
  }
}

function parsePorcelain(output: string): GitChangedFile[] {
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "unknown",
      path: line.slice(3)
    }));
}
