"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, X } from "lucide-react";
import Image from "next/image";
import { useState, useEffect } from "react";
// VibeKit Auth (browser SDK)
import {
  ClaudeWebAuth,
  LocalStorageTokenStorage,
} from "@vibe-kit/auth/browser";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { authClient } from "@/lib/auth/auth-client";
import { useAuthSession } from "../session-provider";
import { useModal } from "@/components/layout/modal-context";
import {
  useUserSettings,
  useUpdateUserSettings,
} from "@/hooks/use-user-settings";
import { useDebounceCallback } from "@/lib/debounce";

export function UserSettings() {
  const { session, isLoading: isLoadingSession } = useAuthSession();
  const { closeSettingsModal } = useModal();
  const { data: userSettings, isLoading: isLoadingSettings } =
    useUserSettings();
  const updateUserSettings = useUpdateUserSettings();
  const [rulesValue, setRulesValue] = useState("");
  const [isRulesUpdating, setIsRulesUpdating] = useState(false);

  // Initialize from server state
  useEffect(() => {
    setRulesValue(userSettings?.rules || "");
  }, [userSettings?.rules]);

  // Debounced save to server
  const debouncedSave = useDebounceCallback((value: string) => {
    setIsRulesUpdating(true);
    updateUserSettings.mutate(
      { rules: value || null },
      {
        onSettled: () => {
          setIsRulesUpdating(false);
        },
      }
    );
  }, 1000);

  const handleSignOut = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = "/auth";
          },
        },
      });
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const handleAutoPRToggle = (checked: boolean) => {
    updateUserSettings.mutate({ autoPullRequest: checked });
  };

  const handleMemoriesEnabledToggle = (checked: boolean) => {
    updateUserSettings.mutate({ memoriesEnabled: checked });
  };

  const handleShadowWikiToggle = (checked: boolean) => {
    updateUserSettings.mutate({ enableShadowWiki: checked });
  };

  const handleIndexingToggle = (checked: boolean) => {
    updateUserSettings.mutate({ enableIndexing: checked });
  };

  const handleRulesChange = (value: string) => {
    const words = value
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    if (words.length <= 100) {
      setRulesValue(value);
      debouncedSave(value);
    }
  };

  // --- VibeKit Auth: Claude ---
  const [claudeAuthUrl, setClaudeAuthUrl] = useState<string | null>(null);
  const [claudeState, setClaudeState] = useState<string | null>(null);
  const [claudeVerifier, setClaudeVerifier] = useState<string | null>(null);
  const [pasteCode, setPasteCode] = useState("");
  const [claudeStatus, setClaudeStatus] = useState<
    "idle" | "waiting" | "success" | "error"
  >("idle");
  const [claudeConnected, setClaudeConnected] = useState<boolean | null>(null);

  const storage = new LocalStorageTokenStorage();
  const claudeAuth = new ClaudeWebAuth(storage);
  useEffect(() => {
    // Probe current status on open
    void checkClaudeStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initiateClaudeSignIn = async () => {
    try {
      const { url, state, codeVerifier } = await ClaudeWebAuth.createAuthorizationUrl();
      setClaudeAuthUrl(url);
      setClaudeState(state);
      setClaudeVerifier(codeVerifier);
      setClaudeStatus("waiting");
      // Open Claude's auth page in a new tab for the user to copy code#state
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error(e);
      setClaudeStatus("error");
    }
  };

  const completeClaudeSignIn = async () => {
    if (!claudeVerifier || !claudeState) return;
    try {
      await claudeAuth.authenticate(pasteCode.trim(), claudeVerifier, claudeState);
      setClaudeStatus("success");
      setClaudeConnected(true);
    } catch (e) {
      console.error("Claude auth failed", e);
      setClaudeStatus("error");
    }
  };

  const checkClaudeStatus = async () => {
    try {
      const ok = await claudeAuth.isAuthenticated();
      setClaudeConnected(ok);
      setClaudeStatus(ok ? "success" : "idle");
    } catch {
      setClaudeConnected(false);
    }
  };

  const logoutClaude = async () => {
    try {
      await claudeAuth.logout();
      setClaudeConnected(false);
      setClaudeStatus("idle");
      setPasteCode("");
      setClaudeAuthUrl(null);
      setClaudeState(null);
      setClaudeVerifier(null);
    } catch (e) {
      console.error("Claude logout failed", e);
    }
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {isLoadingSession ? (
        <div className="text-muted-foreground flex items-center gap-1">
          Loading user info... <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : !session?.user ? (
        <div className="text-destructive flex items-center gap-1.5">
          Failed to load user info <X className="size-3.5" />
        </div>
      ) : (
        <>
          <div className="flex flex-col items-start justify-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {session.user.image && (
                <Image
                  src={session.user.image}
                  alt={session.user.name || "User"}
                  className="rounded-full"
                  width={48}
                  height={48}
                />
              )}
              <div className="flex flex-col">
                <span className="font-medium">{session.user.name}</span>
                <span className="text-muted-foreground text-sm">
                  {session.user.email}
                </span>
              </div>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                handleSignOut();
                closeSettingsModal();
              }}
            >
              Sign Out
            </Button>
          </div>

          {/* User Settings Section */}
          <div className="flex w-full flex-col gap-4 border-t pt-4">
            {/* Execution Backend Selection */}
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="execution-backend" className="flex flex-col gap-0">
                <div className="text-sm font-normal">Execution Backend</div>
                <div className="text-muted-foreground text-xs">
                  Where tasks run: Kubernetes (Kata) or VibeKit sandboxes
                </div>
              </label>
              <div className="w-[220px]">
                <Select
                  value={(userSettings?.executionBackend as any) || "k8s"}
                  onValueChange={(val) =>
                    updateUserSettings.mutate({ executionBackend: val as any })
                  }
                  disabled={isLoadingSettings}
                >
                  <SelectTrigger id="execution-backend">
                    <SelectValue placeholder="Select backend" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="k8s">Kubernetes (Kata)</SelectItem>
                    <SelectItem value="vibekit">VibeKit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* VibeKit Provider Selection */}
            {((userSettings?.executionBackend as any) || "k8s") === "vibekit" && (
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="vibekit-provider" className="flex flex-col gap-0">
                  <div className="text-sm font-normal">VibeKit Provider</div>
                  <div className="text-muted-foreground text-xs">
                    Choose a sandbox provider for VibeKit
                  </div>
                </label>
                <div className="w-[220px]">
                  <Select
                    value={(userSettings?.vibekitProvider as any) || "e2b"}
                    onValueChange={(val) =>
                      updateUserSettings.mutate({ vibekitProvider: val as any })
                    }
                    disabled={isLoadingSettings}
                  >
                    <SelectTrigger id="vibekit-provider">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="e2b">E2B</SelectItem>
                      <SelectItem value="northflank">Northflank</SelectItem>
                      <SelectItem value="daytona">Daytona</SelectItem>
                      <SelectItem value="cloudflare">Cloudflare</SelectItem>
                      <SelectItem value="dagger">Dagger (local)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* VibeKit Auth Section */}
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="text-sm font-medium">VibeKit Auth</div>
              <div className="text-muted-foreground text-xs">
                Connect your Claude MAX subscription. After clicking, copy the
                code#state from Claude and paste it below to complete.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={initiateClaudeSignIn} disabled={claudeStatus === "waiting"}>
                  {claudeStatus === "waiting" ? (
                    <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Waiting for code…</span>
                  ) : (
                    "Sign in with Claude"
                  )}
                </Button>
                <Button size="sm" variant="secondary" disabled title="Coming soon via VibeKit Auth">
                  Sign in with Codex
                </Button>

                <Button size="sm" variant="outline" onClick={checkClaudeStatus}>
                  Check status
                </Button>
                <Button size="sm" variant="ghost" onClick={logoutClaude}>
                  Disconnect Claude
                </Button>
                {claudeConnected != null && (
                  <span className={`text-xs ${claudeConnected ? "text-green-600" : "text-muted-foreground"}`}>
                    {claudeConnected ? "Connected" : "Not connected"}
                  </span>
                )}
              </div>

              {claudeStatus === "waiting" && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-muted-foreground">
                    Paste code#state from Claude
                  </label>
                  <div className="flex items-center gap-2">
                    <Textarea
                      placeholder="code#state"
                      value={pasteCode}
                      onChange={(e) => setPasteCode(e.target.value)}
                      className="min-h-[42px]"
                    />
                    <Button size="sm" onClick={completeClaudeSignIn}>
                      Complete
                    </Button>
                  </div>
                  {claudeAuthUrl && (
                    <div className="text-[11px] text-muted-foreground break-all">
                      Auth URL: {claudeAuthUrl}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="auto-pr" className="flex flex-col gap-0">
                <div className="text-sm font-normal">
                  Auto-Create Pull Requests
                </div>
                <div className="text-muted-foreground text-xs">
                  Automatically draft pull requests when tasks complete
                </div>
              </label>
              <Checkbox
                id="auto-pr"
                checked={userSettings?.autoPullRequest ?? false}
                onCheckedChange={handleAutoPRToggle}
                disabled={isLoadingSettings}
              />
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="memories-enabled" className="flex flex-col gap-0">
                <div className="text-sm font-normal">Enable Memories</div>
                <div className="text-muted-foreground text-xs">
                  Allow the agent to manage long-term memories (by repository)
                </div>
              </label>
              <Checkbox
                id="memories-enabled"
                checked={userSettings?.memoriesEnabled ?? false}
                onCheckedChange={handleMemoriesEnabledToggle}
                disabled={isLoadingSettings}
              />
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="shadow-wiki" className="flex flex-col gap-0">
                <div className="text-sm font-normal">Enable Shadow Wiki</div>
                <div className="text-muted-foreground text-xs">
                  Auto-generate codebase understanding docs for AI context
                </div>
              </label>
              <Checkbox
                id="shadow-wiki"
                checked={userSettings?.enableShadowWiki ?? true}
                onCheckedChange={handleShadowWikiToggle}
                disabled={isLoadingSettings}
              />
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="enable-indexing" className="flex flex-col gap-0">
                <div className="text-sm font-normal">
                  Enable Semantic Search
                </div>
                <div className="text-muted-foreground text-xs">
                  Embed your codebases to let the agent do semantic search
                </div>
              </label>
              <Checkbox
                id="enable-indexing"
                checked={userSettings?.enableIndexing ?? false}
                onCheckedChange={handleIndexingToggle}
                disabled={isLoadingSettings}
              />
            </div>

            {/* Rules Section */}
            <div className="flex flex-col gap-2">
              <label htmlFor="rules" className="flex flex-col gap-0">
                <div className="flex items-center gap-1.5">
                  <div className="text-sm font-normal">Rules</div>
                  {isRulesUpdating && (
                    <Loader2 className="text-muted-foreground size-3 animate-spin" />
                  )}
                </div>
                <div className="text-muted-foreground text-xs">
                  Custom instructions for agent responses (
                  {
                    rulesValue
                      .trim()
                      .split(/\s+/)
                      .filter((word) => word.length > 0).length
                  }
                  /100 words)
                </div>
              </label>
              <Textarea
                id="rules"
                placeholder="Enter specific instructions for Shadow..."
                value={rulesValue}
                onChange={(e) => handleRulesChange(e.target.value)}
                disabled={isLoadingSettings}
                className="text-[13px]! min-h-[80px] resize-none"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
