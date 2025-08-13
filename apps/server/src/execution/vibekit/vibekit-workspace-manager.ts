import { WorkspaceManager } from "../interfaces/workspace-manager";
import { ToolExecutor } from "../interfaces/tool-executor";
import {
  WorkspaceInfo,
  WorkspaceStatus,
  HealthStatus,
  TaskConfig,
} from "../interfaces/types";
import { getGitHubAccessToken } from "@/github/auth/account-service";
import { getGitHubAppEmail, getGitHubAppName } from "@/config/shared";
import config from "@/config";
import { prisma } from "@repo/db";
import { buildSandboxProvider, getVibekitWorkdir } from "./provider";
import { VibeKitToolExecutor } from "./vibekit-tool-executor";

export class VibeKitWorkspaceManager implements WorkspaceManager {
  async prepareWorkspace(taskConfig: TaskConfig): Promise<WorkspaceInfo> {
    try {
      const githubToken = await getGitHubAccessToken(taskConfig.userId);
      if (!githubToken) {
        throw new Error(
          `No GitHub access token found for user ${taskConfig.userId}`
        );
      }

      // Use user's preferred provider if set
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId: taskConfig.userId },
        select: { vibekitProvider: true },
      });
      const provider = buildSandboxProvider(
        (userSettings?.vibekitProvider as any) || undefined
      );
      const workdir = getVibekitWorkdir();

      const envs: Record<string, string> = {
        GITHUB_TOKEN: githubToken,
      };

      const sandbox = await provider.create(envs, undefined, workdir);

      // Clone repository and prepare branch
      const repoUrl = taskConfig.repoUrl.replace(
        /^https:\/\//,
        `https://${githubToken}@`
      );

      // Ensure working directory exists and clone
      await sandbox.commands.run(
        `mkdir -p ${workdir} && cd ${workdir} && git clone --depth 1 --branch ${taskConfig.baseBranch} ${repoUrl} .`
      );

      // Configure git user and create shadow branch
      await sandbox.commands.run(
        `cd ${workdir} && git config user.name "${getGitHubAppName(
          config
        )}" && git config user.email "${getGitHubAppEmail(config)}" && git checkout -b ${taskConfig.shadowBranch}`
      );

      // Persist sandbox session mapping
      await prisma.taskSession.create({
        data: {
          taskId: taskConfig.id,
          isActive: true,
          connectionId: sandbox.sandboxId, // reuse existing field to store sandbox id
        },
      });

      return {
        success: true,
        workspacePath: workdir,
        serviceName: sandbox.sandboxId,
      };
    } catch (error) {
      return {
        success: false,
        workspacePath: "",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async cleanupWorkspace(taskId: string): Promise<{ success: boolean; message: string }> {
    try {
      const session = await prisma.taskSession.findFirst({
        where: { taskId, isActive: true },
        orderBy: { createdAt: "desc" },
      });

      if (session?.connectionId) {
        const provider = buildSandboxProvider();
        const sandbox = await provider.resume(session.connectionId);
        await sandbox.kill();
      }

      await prisma.taskSession.updateMany({
        where: { taskId, isActive: true },
        data: { isActive: false, endedAt: new Date() },
      });

      return { success: true, message: `VibeKit sandbox cleaned for ${taskId}` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getWorkspaceStatus(taskId: string): Promise<WorkspaceStatus> {
    try {
      const session = await prisma.taskSession.findFirst({
        where: { taskId, isActive: true },
        orderBy: { createdAt: "desc" },
      });

      if (!session?.connectionId) {
        return { exists: false, path: "", isReady: false };
      }

      // Try to list directory root via executor to confirm readiness
      const exec = await this.getExecutor(taskId);
      const listing = await exec.listDirectory(".");
      return {
        exists: true,
        path: getVibekitWorkdir(),
        isReady: !!(listing.success && listing.contents && listing.contents.length >= 0),
      };
    } catch (error) {
      return {
        exists: false,
        path: "",
        isReady: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  getWorkspacePath(): string {
    return getVibekitWorkdir();
  }

  async workspaceExists(taskId: string): Promise<boolean> {
    const session = await prisma.taskSession.findFirst({
      where: { taskId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return !!session?.connectionId;
  }

  async getExecutor(taskId: string): Promise<ToolExecutor> {
    const session = await prisma.taskSession.findFirst({
      where: { taskId, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    if (!session?.connectionId) {
      throw new Error(`No active VibeKit session for task ${taskId}`);
    }

    const provider = buildSandboxProvider();
    const sandbox = await provider.resume(session.connectionId);
    return new VibeKitToolExecutor(taskId, sandbox, getVibekitWorkdir());
  }

  async healthCheck(taskId: string): Promise<HealthStatus> {
    try {
      const status = await this.getWorkspaceStatus(taskId);
      return {
        healthy: status.exists && status.isReady,
        message: status.exists
          ? status.isReady
            ? "VibeKit workspace healthy"
            : "VibeKit workspace not ready"
          : "VibeKit workspace missing",
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  isRemote(): boolean {
    return true;
  }
}
