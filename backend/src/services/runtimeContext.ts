import { existsSync, readFileSync } from 'node:fs';
import { hostname, platform } from 'node:os';

/**
 * **Where a Cronsole-native task actually executes.**
 *
 * This exists because of one specific way the `EXEC` job type can lie. A native
 * job runs wherever *this backend* runs. On a host-run stack that is the user's
 * machine, and `C:\scripts\backup.ps1` means what they think it means. In the
 * Dockerized backend the same task — same UI, same spec, same source — runs
 * **inside the container**, against a filesystem that is not theirs, with a PATH
 * that does not contain their tools. It does not fail loudly; it fails as
 * "executable not found" for a file they can see in Explorer.
 *
 * One task, one interface, two entirely different meanings, and nothing on
 * screen to tell them apart. So the New Task modal says which one it is, and
 * this is where that fact comes from. **A task that cannot say where it executes
 * is the same class of defect as a timestamp that cannot say what it measured**
 * (troubleshooting #42) — plausible, first-hand, and about the wrong thing.
 *
 * Detected once at import: the answer cannot change without the process
 * restarting, and re-deriving it per request would be work that can only produce
 * the same answer.
 */

export type ExecutionHostKind = 'host' | 'container';

export interface ExecutionHost {
  kind: ExecutionHostKind;
  /** Which signal decided it — the evidence, never just the verdict. */
  evidence: string;
  /** One sentence for the UI, in the user's terms. */
  summary: string;
  /** `process.platform`, so the UI can talk about `.ps1` vs `.sh` honestly. */
  os: NodeJS.Platform;
  hostname: string;
}

/** Container tells, cheapest and most decisive first. */
function detectContainer(): string | null {
  // Docker writes this into every container it starts.
  if (existsSync('/.dockerenv')) return '/.dockerenv exists';
  // Kubernetes injects this into every pod.
  if (process.env.KUBERNETES_SERVICE_HOST) return 'KUBERNETES_SERVICE_HOST is set';
  // Podman and some runtimes.
  if (existsSync('/run/.containerenv')) return '/run/.containerenv exists';
  // cgroup v1 names the runtime in PID 1's cgroup path. Wrapped because this is
  // absent on Windows and unreadable under some hardened kernels — and a
  // detector that throws would take the whole boot with it.
  try {
    const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods|podman|lxc/i.test(cgroup)) {
      return '/proc/1/cgroup names a container runtime';
    }
  } catch {
    // Not Linux, or not readable. Absence of the file is not evidence either way,
    // so it simply does not vote.
  }
  return null;
}

function build(): ExecutionHost {
  const os = platform();
  const host = hostname();
  const containerEvidence = detectContainer();

  if (containerEvidence) {
    return {
      kind: 'container',
      evidence: containerEvidence,
      summary:
        'Cronsole-native tasks run inside the backend container, not on your machine. ' +
        'Paths and programs must exist in the container.',
      os,
      hostname: host
    };
  }

  return {
    kind: 'host',
    evidence: 'no container runtime detected',
    summary: `Cronsole-native tasks run directly on ${host}.`,
    os,
    hostname: host
  };
}

export const executionHost: ExecutionHost = build();
