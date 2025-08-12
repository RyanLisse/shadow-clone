import { ToolExecutor } from "../interfaces/tool-executor";
import {
  CommandOptions,
  DeleteResult,
  DirectoryListing,
  FileResult,
  FileSearchResult,
  FileStatsResult,
  GrepOptions,
  GrepResult,
  ReadFileOptions,
  SearchOptions,
  WriteResult,
  SearchReplaceResult,
  SemanticSearchToolResult,
  GitStatusResponse,
  GitDiffResponse,
  GitCommitResponse,
  GitPushResponse,
  GitCommitRequest,
  GitPushRequest,
  GitConfigResponse,
  GitBranchResponse,
  GitBranchInfoResponse,
  GitCommitInfoResponse,
  GitCheckoutResponse,
  GitCommitMessagesResponse,
  RecursiveDirectoryListing,
} from "@repo/types";
import type { SandboxInstance } from "@vibe-kit/sdk";
import { CommandResult } from "../interfaces/types";
import { performSemanticSearch } from "@/utils/semantic-search";

export class VibeKitToolExecutor implements ToolExecutor {
  private taskId: string;
  private sandbox: SandboxInstance;
  private workdir: string;

  constructor(taskId: string, sandbox: SandboxInstance, workdir: string) {
    this.taskId = taskId;
    this.sandbox = sandbox;
    this.workdir = workdir;
  }

  private async run(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const res = await this.sandbox.commands.run(cmd);
    return { code: res.exitCode, stdout: res.stdout, stderr: res.stderr };
  }

  async readFile(targetFile: string, _options?: ReadFileOptions): Promise<FileResult> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && cat ${escapePath(targetFile)}`);
    if (code === 0) return { success: true, path: targetFile, content: stdout };
    return { success: false, error: stderr || `Failed to read file: ${targetFile}`, message: `Failed to read file: ${targetFile}` };
  }

  async getFileStats(targetFile: string): Promise<FileStatsResult> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && stat -c '%F|%s|%Y' ${escapePath(targetFile)}`);
    if (code === 0) {
      const [type, size, mtime] = stdout.trim().split("|");
      return { success: true, path: targetFile, size: Number(size), modifiedTime: Number(mtime), isDirectory: type.includes("directory") };
    }
    return { success: false, error: stderr || `Failed to stat file: ${targetFile}`, message: `Failed to get file stats: ${targetFile}` };
  }

  async writeFile(targetFile: string, content: string, _instructions: string, isNewFile?: boolean): Promise<WriteResult> {
    const { code, stderr } = await this.run(`cd ${this.workdir} && mkdir -p $(dirname ${escapePath(targetFile)}) && cat > ${escapePath(targetFile)} << 'EOF'\n${escapeEOF(content)}\nEOF`);
    if (code === 0) return { success: true, path: targetFile, isNewFile: !!isNewFile };
    return { success: false, error: stderr || `Failed to write file: ${targetFile}`, message: `Failed to write file: ${targetFile}`, isNewFile: !!isNewFile };
  }

  async deleteFile(targetFile: string): Promise<DeleteResult> {
    const { code, stderr } = await this.run(`cd ${this.workdir} && rm -f ${escapePath(targetFile)}`);
    if (code === 0) return { success: true, path: targetFile };
    return { success: false, error: stderr || `Failed to delete file: ${targetFile}`, message: `Failed to delete file: ${targetFile}` };
  }

  async searchReplace(filePath: string, oldString: string, newString: string, isNewFile?: boolean): Promise<SearchReplaceResult> {
    const tmpOld = escapeSed(oldString);
    const tmpNew = escapeSed(newString);
    const { code, stderr } = await this.run(`cd ${this.workdir} && sed -i 's/${tmpOld}/${tmpNew}/g' ${escapePath(filePath)}`);
    if (code === 0) return { success: true, isNewFile: !!isNewFile, linesAdded: 0, linesRemoved: 0, occurrences: 0, oldLength: 0, newLength: 0 };
    return { success: false, error: stderr || `Search-replace failed: ${filePath}`, message: `Failed to search and replace in file: ${filePath}`, isNewFile: !!isNewFile, linesAdded: 0, linesRemoved: 0, occurrences: 0, oldLength: 0, newLength: 0 };
  }

  async listDirectory(relativeWorkspacePath: string): Promise<DirectoryListing> {
    const dir = relativeWorkspacePath || ".";
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && ls -la ${escapePath(dir)}`);
    if (code === 0) {
      const lines = stdout.split("\n").filter(Boolean).slice(1);
      const contents = lines.map((l) => {
        const parts = l.trim().split(/\s+/);
        const name = parts.slice(8).join(" ");
        const isDirectory = l[0] === 'd';
        return { name, path: `${dir}/${name}`.replace(/\\/g, "/"), isDirectory };
      });
      return { success: true, path: dir, contents } as DirectoryListing;
    }
    return { success: false, error: stderr || `Failed to list directory: ${dir}`, path: dir, message: `Failed to list directory: ${dir}` };
  }

  async listDirectoryRecursive(relativeWorkspacePath: string = "."): Promise<RecursiveDirectoryListing> {
    const dir = relativeWorkspacePath || ".";
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && find ${escapePath(dir)} -maxdepth 6 -printf '%y|%p\n'`);
    if (code === 0) {
      const entries = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [type, path] = line.split("|");
          return { name: path.split("/").pop() || path, path, isDirectory: type === "d" };
        });
      return { success: true, basePath: dir, entries, totalCount: entries.length };
    }
    return { success: false, error: stderr || `Failed to list recursively: ${dir}`, entries: [], basePath: dir, totalCount: 0, message: `Failed to list directory recursively: ${dir}` };
  }

  async searchFiles(query: string, _options?: SearchOptions): Promise<FileSearchResult> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && rg -n --files -g "*${escapeGlob(query)}*" || true`);
    if (code === 0 || code === 2) {
      const files = stdout.split("\n").filter(Boolean);
      return { success: true, query, files, count: files.length };
    }
    return { success: false, error: stderr || `Failed to search files`, query, files: [], count: 0, message: `Failed to search files: ${query}` };
  }

  async grepSearch(query: string, options?: GrepOptions): Promise<GrepResult> {
    const dir = options?.path || ".";
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && rg -n ${shellQuote(query)} ${escapePath(dir)} || true`);
    if (code === 0 || code === 2) {
      const matches = stdout.split("\n").filter(Boolean).map((l) => ({ line: l }));
      return { success: true, query, matches, detailedMatches: [], matchCount: matches.length } as unknown as GrepResult;
    }
    return { success: false, error: stderr || `grep failed`, query, matches: [], detailedMatches: [], matchCount: 0, message: `Failed to search with grep: ${query}` };
  }

  async semanticSearch(query: string, repo: string): Promise<SemanticSearchToolResult> {
    try { return await performSemanticSearch({ query, repo }); } catch (e) {
      return { success: false, results: [], query, searchTerms: query.split(/\s+/).filter(Boolean), message: `Semantic search failed`, error: e instanceof Error ? e.message : "Unknown error" };
    }
  }

  async executeCommand(command: string, _options?: CommandOptions): Promise<CommandResult> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && ${command}`);
    return { success: code === 0, exitCode: code, command, stdout, stderr, message: code === 0 ? undefined : `Failed to execute command: ${command}` } as CommandResult;
  }

  getWorkspacePath(): string { return this.workdir; }
  isRemote(): boolean { return true; }
  getTaskId(): string { return this.taskId; }

  // Git helpers via shell
  async getGitStatus(): Promise<GitStatusResponse> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && git status --porcelain`);
    if (code === 0) return { success: true, hasChanges: stdout.trim().length > 0 };
    return { success: false, error: stderr || "git status failed", message: "Failed to get git status", hasChanges: false };
  }

  async getGitDiff(): Promise<GitDiffResponse> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && git diff`);
    if (code === 0) return { success: true, diff: stdout };
    return { success: false, error: stderr || "git diff failed", message: "Failed to get git diff", diff: "" };
  }

  async commitChanges(request: GitCommitRequest): Promise<GitCommitResponse> {
    const msg = request.message || "Update";
    const add = await this.run(`cd ${this.workdir} && git add -A`);
    if (add.code !== 0) return { success: false, error: add.stderr || "git add failed", message: "Failed to commit changes" };
    const { code, stderr } = await this.run(`cd ${this.workdir} && git commit -m ${shellQuote(msg)}`);
    if (code === 0) return { success: true };
    return { success: false, error: stderr || "git commit failed", message: "Failed to commit changes" };
  }

  async pushChanges(_request: GitPushRequest): Promise<GitPushResponse> {
    const { code, stderr } = await this.run(`cd ${this.workdir} && git push --set-upstream origin $(git rev-parse --abbrev-ref HEAD)`);
    if (code === 0) return { success: true };
    return { success: false, error: stderr || "git push failed", message: "Failed to push changes" };
  }

  async configureGitUser(_user: { name: string; email: string }): Promise<GitConfigResponse> {
    // Already configured during workspace preparation
    return { success: true };
  }

  async getBranch(): Promise<GitBranchResponse> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && git rev-parse --abbrev-ref HEAD`);
    if (code === 0) return { success: true, branch: stdout.trim() } as GitBranchResponse;
    return { success: false, error: stderr || "git branch failed", message: "Failed to get branch" };
  }

  async getBranchInfo(): Promise<GitBranchInfoResponse> {
    const current = await this.getBranch();
    if (!current.success) return { success: false, error: current.error, message: current.message } as GitBranchInfoResponse;
    return { success: true, currentBranch: (current as any).branch } as GitBranchInfoResponse;
  }

  async getCommitInfo(_commitHash: string): Promise<GitCommitInfoResponse> {
    return { success: false, error: "Not implemented", message: "Not implemented" } as GitCommitInfoResponse;
  }

  async checkoutBranch(_branch: string): Promise<GitCheckoutResponse> {
    return { success: false, error: "Not implemented", message: "Not implemented" } as GitCheckoutResponse;
  }

  async getCommitMessages(): Promise<GitCommitMessagesResponse> {
    const { code, stdout, stderr } = await this.run(`cd ${this.workdir} && git log --oneline -n 100`);
    if (code === 0) return { success: true, messages: stdout.split("\n").filter(Boolean) } as unknown as GitCommitMessagesResponse;
    return { success: false, error: stderr || "git log failed", message: "Failed to get commit messages", messages: [] } as unknown as GitCommitMessagesResponse;
  }
}

function escapePath(p: string) {
  return `'` + p.replace(/'/g, "'\\''") + `'`;
}
function shellQuote(s: string) { return `'` + s.replace(/'/g, "'\\''") + `'`; }
function escapeEOF(s: string) { return s.replace(/EOF/g, "EO_F"); }
function escapeSed(s: string) { return s.replace(/[\\/\n\r\t&]/g, (m) => ({"\\":"\\\\","/":"\\/","\n":"","\r":"","\t":"\\t","&":"\\&"}[m] as string)); }
function escapeGlob(s: string) { return s.replace(/([\[\]*?{}()!])/g, "\\$1"); }

