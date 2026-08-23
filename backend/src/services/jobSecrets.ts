import type { NativeJob } from './NativeTaskExecutor.js';

/**
 * How a Cronsole-native job **refers to** a secret — ADR 0003, the pure half.
 *
 * A job stores no credential. It stores a *reference* — `${secret.NAME}` — and
 * the value lives AES-256-GCM encrypted in its own `TaskSecret` row, under the
 * same key and the same envelope `PlatformConnection.config` uses. Reading and
 * writing that row is `taskSecrets.ts`; **this file touches no database and no
 * key**, which is what lets `NativeTaskExecutor` import it without dragging
 * Prisma into the executor's module graph.
 *
 * Three properties hold this together and none of them is optional:
 *
 * 1. **The stored job stays plaintext and readable.** That was `SCRIPT`'s whole
 *    argument for existing (ADR 0002), and encrypting fields in place would have
 *    taken it back. A reader can see exactly which secrets a job needs without
 *    being able to read one.
 * 2. **There is no read path.** Not a filter someone can forget — no route
 *    returns a value, and `listTaskSecretNames` is what a caller gets instead.
 * 3. **Substitution and redaction are the same act.** `resolveJobSecrets` and
 *    `redactSecrets` are both called by `executeJob`, at the single point every
 *    job type funnels through, so a fifth job type cannot ship having resolved a
 *    secret into a command line and then logged the command line.
 *
 * What redaction does *not* promise is written down here rather than only in the
 * ADR, because this is the file someone reads before trusting it: it removes
 * **known values** from output Cronsole captured. A script that base64-encodes
 * its token before printing defeats it. It closes the accident, not the
 * determined leak — the same class of guarantee as `childEnv()`.
 */

/** `${secret.NAME}`, capturing NAME. Global: a field may hold several. */
const SECRET_REF = /\$\{secret\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** What a secret may be called. Env-variable shaped, because that is where most of them end up. */
export const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** No name longer than this — it is a label, not a payload. */
export const MAX_SECRET_NAME_LENGTH = 64;

/**
 * The shortest value that can be stored.
 *
 * Not arbitrary, and the refusal says so: redaction is a substring replace over
 * captured output, so a one- or two-character secret would blank that character
 * out of every word a job prints. Below this length the choice is between a
 * useless log and a leaking one, and neither is a thing to ship silently.
 */
export const MIN_SECRET_VALUE_LENGTH = 4;

/** A value is a credential, not a file. */
export const MAX_SECRET_VALUE_LENGTH = 4096;

/** A task may not accumulate an unbounded credential store. */
export const MAX_SECRETS_PER_TASK = 25;

/** A refusal the caller should surface as a 400 — bad input, not a bug. */
export class TaskSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskSecretError';
  }
}

// ---------------------------------------------------------------------------
// Where a reference is legal
// ---------------------------------------------------------------------------

/**
 * The closed set of fields a `${secret.NAME}` may appear in, per job type.
 *
 * **A closed list rather than "any string field", and the exclusions carry the
 * reasoning.** `EXEC.executable` and `SCRIPT.interpreter` are deliberately
 * absent: a secret that names *which program runs* is not a use of a secret, it
 * is a way to make the run log unreadable and — for `SCRIPT` — to defeat the
 * interpreter allowlist that is that type's entire security property. A ref
 * anywhere else is refused by `validateJob`, by name, exactly as an unrecognized
 * `jobType` is.
 */
export const SECRET_REF_FIELDS: Readonly<Record<string, readonly string[]>> = {
  HTTP: ['url', 'headers.*', 'body'],
  EXEC: ['args[]', 'env.*'],
  SCRIPT: ['body', 'env.*'],
  CHECK: ['probe.url', 'probe.headers.*']
};

/** Does this string carry at least one `${secret.…}`? */
export function hasSecretRef(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  SECRET_REF.lastIndex = 0;
  return SECRET_REF.test(value);
}

/** Every secret name referenced by one string, in order. */
function refsInString(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const out: string[] = [];
  for (const match of value.matchAll(SECRET_REF)) out.push(match[1]!);
  return out;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Every secret name a job refers to, deduplicated, in the order first seen.
 *
 * Reads only the **legal** fields, so it agrees with `validateJob` by
 * construction: a ref sitting in an illegal field is not something this reports
 * as required, it is something the spec check refuses outright.
 */
export function secretRefsIn(job: unknown): string[] {
  const j = asRecord(job);
  const found: string[] = [];
  const take = (v: unknown) => { for (const name of refsInString(v)) found.push(name); };
  const takeValues = (v: unknown) => { for (const value of Object.values(asRecord(v))) take(value); };

  if (j.jobType === 'HTTP') {
    take(j.url);
    takeValues(j.headers);
    take(j.body);
  } else if (j.jobType === 'EXEC') {
    if (Array.isArray(j.args)) for (const a of j.args) take(a);
    takeValues(j.env);
  } else if (j.jobType === 'SCRIPT') {
    take(j.body);
    takeValues(j.env);
  } else if (j.jobType === 'CHECK') {
    const probe = asRecord(j.probe);
    if (probe.kind === 'http') {
      take(probe.url);
      takeValues(probe.headers);
    }
  }

  return [...new Set(found)];
}

/**
 * Find a `${secret.…}` sitting in a field that may not hold one, and name both.
 *
 * Returns the refusal sentence, or null. Walked field by field rather than by a
 * blanket scan of the serialized job, because the message has to say *which*
 * field — "there is a secret reference somewhere in this job" is a sentence that
 * sends someone hunting.
 */
export function illegalSecretRef(job: unknown): string | null {
  const j = asRecord(job);

  const refuse = (field: string, why: string) =>
    `A \${secret.…} reference is not allowed in ${field} — ${why}. ` +
    `For a ${String(j.jobType)} job it may appear in: ${(SECRET_REF_FIELDS[String(j.jobType)] ?? []).join(', ')}.`;

  if (j.jobType === 'EXEC') {
    if (hasSecretRef(j.executable)) {
      return refuse(
        'a job\'s executable',
        'a secret that names which program runs makes the run log unreadable rather than protecting anything'
      );
    }
    if (hasSecretRef(j.workingDirectory)) {
      return refuse('workingDirectory', 'a directory path is not a credential');
    }
    for (const key of Object.keys(asRecord(j.env))) {
      if (hasSecretRef(key)) return refuse('an env variable *name*', 'only its value can be a secret');
    }
  }

  if (j.jobType === 'SCRIPT') {
    if (hasSecretRef(j.interpreter)) {
      return refuse(
        'the interpreter',
        'the interpreter is a fixed allowlist, and hiding which entry was chosen defeats it'
      );
    }
    if (hasSecretRef(j.workingDirectory)) {
      return refuse('workingDirectory', 'a directory path is not a credential');
    }
    for (const key of Object.keys(asRecord(j.env))) {
      if (hasSecretRef(key)) return refuse('an env variable *name*', 'only its value can be a secret');
    }
  }

  if (j.jobType === 'HTTP') {
    if (hasSecretRef(j.method)) return refuse('the HTTP method', 'the method is one of a fixed set');
    for (const key of Object.keys(asRecord(j.headers))) {
      if (hasSecretRef(key)) return refuse('a header *name*', 'only its value can be a secret');
    }
  }

  if (j.jobType === 'CHECK') {
    const probe = asRecord(j.probe);
    if (hasSecretRef(probe.kind)) return refuse('a probe kind', 'the kind is one of a fixed set');
    if (probe.kind === 'http') {
      if (hasSecretRef(probe.method)) return refuse('the HTTP method', 'the method is one of a fixed set');
      for (const key of Object.keys(asRecord(probe.headers))) {
        if (hasSecretRef(key)) return refuse('a header *name*', 'only its value can be a secret');
      }
      if (hasSecretRef(probe.expectBodyContains) || hasSecretRef(probe.expectJsonPath)) {
        return refuse(
          'a check assertion',
          'an assertion is compared against captured output, so a secret there would be reported back in the log'
        );
      }
    } else {
      // tcp / fileFresh / diskFree hold a host, a port, a path and two numbers.
      // None of them is a credential, and a ref in one would resolve into a log
      // line that names the measured value — which is the whole point of a probe.
      for (const [key, value] of Object.entries(probe)) {
        if (hasSecretRef(value)) {
          return refuse(
            `a ${String(probe.kind)} probe's ${key}`,
            'this probe reports what it measured, so a secret in it would be published by the check itself'
          );
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Resolution and redaction — always together
// ---------------------------------------------------------------------------

/** Names a job refers to that this secret set cannot supply. */
export function missingSecretRefs(job: unknown, available: readonly string[]): string[] {
  const have = new Set(available);
  return secretRefsIn(job).filter(name => !have.has(name));
}

const substitute = (value: unknown, secrets: Record<string, string>): unknown =>
  typeof value === 'string'
    ? value.replace(SECRET_REF, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(secrets, name) ? secrets[name]! : whole)
    : value;

const substituteValues = (
  map: unknown,
  secrets: Record<string, string>
): Record<string, string> | undefined => {
  const source = asRecord(map);
  if (!Object.keys(source).length) return undefined;
  return Object.fromEntries(
    Object.entries(source).map(([k, v]) => [k, String(substitute(v, secrets))])
  );
};

/**
 * Return a copy of the job with every legal reference replaced by its value.
 *
 * **A copy, never a mutation.** The caller is holding the job it read out of
 * `metadata`, and mutating it in place is how a resolved credential ends up
 * written back to the row by the next `prisma.task.update` that happens to carry
 * the same object.
 *
 * An unresolvable reference is left standing rather than replaced with an empty
 * string. It never gets that far in practice — `executeJob` refuses first — but
 * the failure mode matters: a blank would turn `Authorization: Bearer
 * ${secret.X}` into `Authorization: Bearer `, which a server answers with a 401
 * that reads like an expired token rather than like a missing one.
 */
export function resolveJobSecrets(job: NativeJob, secrets: Record<string, string>): NativeJob {
  if (!Object.keys(secrets).length) return job;

  if (job.jobType === 'HTTP') {
    return {
      ...job,
      url: String(substitute(job.url, secrets)),
      headers: substituteValues(job.headers, secrets),
      body: job.body === undefined ? undefined : String(substitute(job.body, secrets))
    };
  }

  if (job.jobType === 'EXEC') {
    return {
      ...job,
      args: job.args?.map(a => String(substitute(a, secrets))),
      env: substituteValues(job.env, secrets)
    };
  }

  if (job.jobType === 'SCRIPT') {
    return {
      ...job,
      body: String(substitute(job.body, secrets)),
      env: substituteValues(job.env, secrets)
    };
  }

  if (job.probe.kind === 'http') {
    return {
      ...job,
      probe: {
        ...job.probe,
        url: String(substitute(job.probe.url, secrets)),
        headers: substituteValues(job.probe.headers, secrets)
      }
    };
  }

  return job;
}

/**
 * Replace every stored secret value found in `text` with the reference that
 * carried it.
 *
 * **`${secret.NAME}` rather than `••••`**, because the reader of a run log is
 * trying to understand what happened: "the Authorization header held
 * `${secret.API_TOKEN}`" is a fact, and four bullets is a hole. It also makes
 * the redaction *visible* — a masked log that reads like an unmasked one is how
 * you stop noticing that the masking broke.
 *
 * Longest value first, so a secret that contains another secret is masked as
 * itself rather than being half-replaced from the inside out.
 */
export function redactSecrets(text: string, secrets: Record<string, string>): string {
  if (!text) return text;
  const entries = Object.entries(secrets)
    .filter(([, value]) => value.length >= MIN_SECRET_VALUE_LENGTH)
    .sort((a, b) => b[1].length - a[1].length);

  let out = text;
  for (const [name, value] of entries) {
    out = out.split(value).join(`\${secret.${name}}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

/** Refuse a bad name/value pair by name, at the boundary. */
export function validateSecret(name: string, value: string): void {
  if (!SECRET_NAME_RE.test(name)) {
    throw new TaskSecretError(
      `"${name}" is not a usable secret name. Use letters, digits and underscores, starting with a ` +
        'letter or underscore — the same shape as an environment variable, which is where most of ' +
        'them end up.'
    );
  }
  if (name.length > MAX_SECRET_NAME_LENGTH) {
    throw new TaskSecretError(`A secret name must be ${MAX_SECRET_NAME_LENGTH} characters or fewer.`);
  }
  if (typeof value !== 'string' || value.length < MIN_SECRET_VALUE_LENGTH) {
    throw new TaskSecretError(
      `A secret must be at least ${MIN_SECRET_VALUE_LENGTH} characters. Cronsole redacts stored ` +
        'secrets out of a job\'s captured output by matching the value, and a value shorter than ' +
        'that would blank those characters out of every word the job prints.'
    );
  }
  if (value.length > MAX_SECRET_VALUE_LENGTH) {
    throw new TaskSecretError(
      `A secret must be ${MAX_SECRET_VALUE_LENGTH} characters or fewer — this is a credential, not a file.`
    );
  }
}
