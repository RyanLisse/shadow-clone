import type { SandboxProvider } from "@vibe-kit/sdk";

import config from "@/config";

// Provider imports are optional; only import what's needed by config
let createE2BProvider: undefined | ((opts: { apiKey: string; templateId?: string }) => SandboxProvider);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  createE2BProvider = require("@vibe-kit/e2b").createE2BProvider;
} catch {
  // package not installed or not needed
}

export type VibekitProviderType =
  | "e2b"
  | "northflank"
  | "daytona"
  | "cloudflare"
  | "dagger";

export function buildSandboxProvider(): SandboxProvider {
  const provider = (config as any).vibekitProvider as VibekitProviderType | undefined;
  const workdir = (config as any).vibekitWorkdir as string | undefined;
  const templateId = (config as any).vibekitTemplateId as string | undefined;

  switch (provider || "e2b") {
    case "e2b": {
      if (!createE2BProvider) {
        throw new Error(
          "@vibe-kit/e2b is not installed. Add it to dependencies to use E2B provider."
        );
      }
      const apiKey = (config as any).e2bApiKey as string | undefined;
      if (!apiKey) {
        throw new Error("E2B_API_KEY is required for VibeKit E2B provider");
      }
      return createE2BProvider({ apiKey, templateId: templateId || undefined });
    }
    default:
      throw new Error(
        `VibeKit provider '${provider}' not supported in this build. Configure VIBEKIT_PROVIDER=e2b to proceed.`
      );
  }
}

export function getVibekitWorkdir(): string {
  return ((config as any).vibekitWorkdir as string) || "/workspace";
}

