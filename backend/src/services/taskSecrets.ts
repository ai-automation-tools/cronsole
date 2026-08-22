import { prisma } from '../db.js';
import { encryptConfig, decryptConfig } from '../auth/encryption.js';
import {
  MAX_SECRETS_PER_TASK,
  TaskSecretError,
  validateSecret
} from './jobSecrets.js';

// Re-exported so a caller that writes a secret imports the refusal it has to
// map to a 400 from the same module as the write, rather than reaching past it
// into the pure half.
export { TaskSecretError } from './jobSecrets.js';

/**
 * Where a Cronsole-native job's secrets are **kept** — ADR 0003, the storage half.
 *
 * `jobSecrets.ts` holds the pure half (the reference syntax, resolution,
 * redaction, boundary validation) and is imported by the executor. This file is
 * the only place that reads or writes `TaskSecret`, and therefore the only place
 * that holds a plaintext credential in memory.
 *
 * Two rules govern everything below:
 *
 * - **There is no read path out of here that a route may call.** `readTaskSecrets`
 *   exists for the executor and for the write paths that need the current set;
 *   what a *reader* gets is `listTaskSecretNames`. That is not a filter someone
 *   can forget to apply — no route returns a value at all.
 * - **An undecryptable row is never an empty set.** See `TaskSecretDecryptError`.
 */

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Raised when the stored envelope cannot be opened.
 *
 * Kept distinct from "there are no secrets", and that distinction is the point:
 * returning `{}` for an undecryptable row would report *no secrets* for a task
 * that has several, and the job would then run with its references unresolved —
 * a wrong answer wearing the shape of a correct one. `ENCRYPTION_KEY` changing
 * is the way this happens.
 */
export class TaskSecretDecryptError extends Error {
  constructor(readonly taskId: string, readonly cause?: unknown) {
    super(
      "This task's stored secrets could not be decrypted. That normally means ENCRYPTION_KEY " +
        'changed since they were saved — the values cannot be recovered, and re-entering them is ' +
        'the only fix.'
    );
    this.name = 'TaskSecretDecryptError';
  }
}

/**
 * Decrypt a task's secrets.
 *
 * **Only the executor and the routes that write one should call this**, and
 * nothing may put the result anywhere that outlives the call. No route returns
 * it; `listTaskSecretNames` is what a reader gets.
 */
export async function readTaskSecrets(taskId: string): Promise<Record<string, string>> {
  const row = await prisma.taskSecret.findUnique({ where: { taskId } });
  if (!row) return {};
  let parsed: unknown;
  try {
    parsed = decryptConfig(row.data);
  } catch (err) {
    // Never `{}` — see TaskSecretDecryptError. An empty set here would run the
    // job with its references unresolved and report nothing wrong.
    throw new TaskSecretDecryptError(taskId, err);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(parsed))) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * The names a task has stored, and when the set last changed — **never a value**.
 *
 * `updatedAt` is per row rather than per secret, and the field is named
 * `secretsUpdatedAt` on the wire for exactly that reason: a per-name timestamp
 * would be a real timestamp of the wrong event, which is the
 * [#42](../../docs/troubleshooting/README.md) shape this codebase has paid for
 * more than once.
 */
export async function listTaskSecretNames(
  taskId: string
): Promise<{ names: string[]; updatedAt: Date | null; unreadable: boolean }> {
  const row = await prisma.taskSecret.findUnique({ where: { taskId } });
  if (!row) return { names: [], updatedAt: null, unreadable: false };
  try {
    const parsed = asRecord(decryptConfig(row.data));
    return { names: Object.keys(parsed).sort(), updatedAt: row.updatedAt, unreadable: false };
  } catch {
    // A row exists and cannot be read. Reporting zero names would say "this task
    // has no secrets", which is false — and the caller would then read a job's
    // references as merely unset rather than as unrecoverable.
    return { names: [], updatedAt: row.updatedAt, unreadable: true };
  }
}

/** Write the whole set, or delete the row when the set is empty. */
async function writeTaskSecrets(taskId: string, secrets: Record<string, string>): Promise<void> {
  if (!Object.keys(secrets).length) {
    await prisma.taskSecret.deleteMany({ where: { taskId } });
    return;
  }
  const data = encryptConfig(secrets);
  await prisma.taskSecret.upsert({
    where: { taskId },
    create: { taskId, data },
    update: { data }
  });
}

/**
 * Set one secret, leaving the rest alone.
 *
 * **Per secret, not per set**, and that is a safety property rather than a
 * convenience. A whole-set `PUT` makes "change one secret" a request that has to
 * resend the others, so a client that forgets destroys them — silently, because
 * there is no read path to notice with.
 */
export async function setTaskSecret(taskId: string, name: string, value: string): Promise<string[]> {
  validateSecret(name, value);
  const current = await readTaskSecrets(taskId);
  if (!Object.prototype.hasOwnProperty.call(current, name) &&
      Object.keys(current).length >= MAX_SECRETS_PER_TASK) {
    throw new TaskSecretError(
      `A task may hold at most ${MAX_SECRETS_PER_TASK} secrets, and this one already has that many.`
    );
  }
  const next = { ...current, [name]: value };
  await writeTaskSecrets(taskId, next);
  return Object.keys(next).sort();
}

/** Remove one secret. Returns whether there was one to remove. */
export async function deleteTaskSecret(taskId: string, name: string): Promise<boolean> {
  const current = await readTaskSecrets(taskId);
  if (!Object.prototype.hasOwnProperty.call(current, name)) return false;
  delete current[name];
  await writeTaskSecrets(taskId, current);
  return true;
}

/**
 * Replace the whole set — the **create** path only.
 *
 * Legal here and nowhere else: a task being created has nothing to preserve, so
 * replace-semantics cannot destroy anything, and it lets "create this task and
 * give it its credential" be one gesture rather than a create followed by a
 * write that can fail on its own.
 */
export async function replaceTaskSecrets(
  taskId: string,
  secrets: Record<string, string>
): Promise<string[]> {
  const names = Object.keys(secrets);
  if (names.length > MAX_SECRETS_PER_TASK) {
    throw new TaskSecretError(`A task may hold at most ${MAX_SECRETS_PER_TASK} secrets.`);
  }
  for (const name of names) validateSecret(name, secrets[name]!);
  await writeTaskSecrets(taskId, secrets);
  return names.sort();
}
