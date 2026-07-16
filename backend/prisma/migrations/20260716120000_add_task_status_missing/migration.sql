-- Adds a MISSING value to TaskStatus. Reconciliation now marks a task absent
-- from the platform's full sync as MISSING (and clears its nextRunTime) instead
-- of hard-deleting the row, so a vanished task is shown honestly rather than
-- either silently removed or left claiming it is active and due. MISSING is
-- self-healing: the next sync that sees the task upserts it back to
-- ACTIVE/DISABLED. See docs/ROADMAP.md › "Reconcile tracked tasks that no
-- longer exist on the platform".
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'MISSING';
