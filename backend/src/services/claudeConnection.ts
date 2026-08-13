import { PlatformType } from '@prisma/client';
import { prisma } from '../db.js';
import { serializeConfig } from '../auth/connectionConfig.js';
import { getClaudeCredential } from './claudeOAuth.js';

/**
 * **A platform Cronsole can already reach must not read as "not connected".**
 *
 * `PlatformConnection` is what makes a platform real to the rest of the app:
 * `POST /api/tasks/sync` enumerates those rows, the Platforms tab renders one
 * card per row, and `POST /api/tasks` refuses a create when the row is missing.
 * For every other platform the row is created by an explicit act — pairing the
 * agent, pasting a routine's token — so "row exists" and "the user set this up"
 * mean the same thing.
 *
 * OAuth mode breaks that equivalence. The moment the backend can read a Claude
 * Code session off the machine, Cronsole can list, create, reschedule and fire
 * routines with **no setup step at all** — and yet with no row, sync would skip
 * the platform entirely and the Platforms tab would show it as unconfigured
 * while the connector was perfectly able to answer. The user would be told to
 * paste per-routine tokens to reach routines Cronsole could already see.
 *
 * So the row is ensured wherever the answer would otherwise be wrong: before a
 * sync enumerates connections, and before a create checks for one.
 *
 * ## Two things this deliberately does not do
 *
 * **It stores no credential.** The config it writes is an empty routine
 * registry, the same shape door 1 uses. The account token stays in
 * `~/.claude/.credentials.json` and is re-read per request — see
 * `claudeOAuth.ts` for why copying it into Postgres would be the wrong trade.
 *
 * **It never overwrites an existing config.** A user who has pasted per-routine
 * tokens has a registry worth keeping: it is what door 1 falls back to when the
 * undocumented API changes, and clobbering it here would quietly destroy the
 * only credentials claude.ai will not re-issue.
 */
export async function ensureClaudeConnection(userId: string): Promise<boolean> {
  if (!getClaudeCredential().credential) return false;

  const existing = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: PlatformType.CLAUDE_CODE } },
    select: { id: true, isActive: true }
  });

  if (existing) {
    // A connection deactivated while the credential is readable is a stale
    // "disconnected" state, not a decision to keep — reactivate it rather than
    // leaving the platform invisible with no way for the user to see why.
    if (!existing.isActive) {
      await prisma.platformConnection.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return false;
  }

  await prisma.platformConnection.create({
    data: {
      userId,
      platform: PlatformType.CLAUDE_CODE,
      isActive: true,
      // An empty registry, not a credential. See the header.
      config: serializeConfig({ routines: [] })
    }
  });
  return true;
}
