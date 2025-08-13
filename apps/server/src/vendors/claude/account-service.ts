import { prisma } from "@repo/db";

/**
 * Get a stored Claude MAX access token for a user, if any.
 * Uses the shared `account` table with `providerId = "claude"`.
 */
export async function getClaudeAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "claude" },
    select: { accessToken: true },
  });
  return account?.accessToken || null;
}

/**
 * Upsert the Claude MAX access token for the user.
 * If `expiresAt` is provided, it is stored in `accessTokenExpiresAt`.
 */
export async function upsertClaudeAccessToken(params: {
  userId: string;
  accessToken: string;
  expiresAt?: Date | null;
}): Promise<void> {
  const { userId, accessToken, expiresAt } = params;

  const existing = await prisma.account.findFirst({
    where: { userId, providerId: "claude" },
    select: { id: true },
  });

  if (existing?.id) {
    await prisma.account.update({
      where: { id: existing.id },
      data: {
        accessToken,
        accessTokenExpiresAt: expiresAt || null,
        updatedAt: new Date(),
      },
    });
    return;
  }

  await prisma.account.create({
    data: {
      userId,
      providerId: "claude",
      accountId: `claude-${userId}`,
      accessToken,
      accessTokenExpiresAt: expiresAt || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Remove the stored Claude token for a user.
 */
export async function deleteClaudeAccessToken(userId: string): Promise<void> {
  await prisma.account.deleteMany({ where: { userId, providerId: "claude" } });
}

