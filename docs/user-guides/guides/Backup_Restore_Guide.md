<a id="backup-restore-top"></a>

<h1 align="center">💾 Backup &amp; Restore</h1>

<p align="center">
  <em>Back up Cronsole's database, schedule it with Cronsole itself, and — the part that matters — test the restore.</em>
</p>

<p align="center">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-user_guides-6B7280?style=for-the-badge" alt="User guides"></a>
  <a href="../../TRUST.md"><img src="https://img.shields.io/badge/see_also-removal_&_uninstall-8B5CF6?style=for-the-badge" alt="Trust"></a>
</p>

---

## Before anything else: what a backup covers

Cronsole's database holds **Cronsole's view of your tasks** — which ones it tracks, your
collections, favorites, saved views, run history, pre-delete archives, and per-job secrets.

It does **not** hold the tasks themselves. Those live in Windows Task Scheduler and on each
platform you connected, and they keep running whether Cronsole exists or not.

So the failure this guide protects against is narrower than "losing your jobs", and worth naming
precisely:

| If you lose the volume | You lose | You do **not** lose |
|:---|:---|:---|
| | Tracked-task rows, collections, favorites, saved views | Any scheduled task, on any platform |
| | Run history and execution logs | Anything Windows recorded itself |
| | Pre-delete archives — **the only copy of a deleted task** | |
| | Per-job secrets (`TaskSecret`) | |
| | Your Cronsole login and preferences | |

The archives row is the sharp one. A pre-delete archive exists precisely because the task it
describes is gone; nothing else anywhere has it.

---

## ⚠️ The trap: a backup without the key is half a backup

Platform credentials (`PlatformConnection.config`) and per-job secrets (`TaskSecret`) are
**AES-256-GCM encrypted before they are stored**. In a dump they look like this:

```
GITHUB_ACTIONS|"26cf31517be5c46621f95a215580442e:22050013cd92569d0d81d26cd0…
```

That is `iv:ciphertext`, and it is decrypted with **`ENCRYPTION_KEY`** from your backend
environment. Restore this dump onto a machine with a different key and the restore *succeeds* —
every row is there, every count matches — and every platform connection is permanently unreadable.
You would find out one source at a time.

**So the key is part of the backup, and it is not in the dump.**

- Record `ENCRYPTION_KEY` somewhere you will still have it after the disk you are protecting
  against dies — a password manager, not a file next to the dump.
- **Do not store it with the dump.** The key is the only thing making that ciphertext safe to keep;
  putting them together turns an encrypted backup into a plaintext one.
- Losing the key is recoverable in the sense that nothing else is lost: reconnect each platform and
  re-enter each job secret by hand. It is not recoverable in the sense of getting the values back.

---

## Taking a backup

One command, run from your clone:

```bash
docker compose exec -T db pg_dump -U taskhub -d taskhub -Fc > cronsole-backup.dump
```

Notes on the flags, because each one is load-bearing:

- **`-T`** disables TTY allocation. Without it Docker injects carriage returns into the stream and
  the resulting file is a corrupt archive that only fails at restore time.
- **`-Fc`** is PostgreSQL's custom format: compressed, and restorable selectively with `pg_restore`.
  A plain `.sql` dump works too but is larger and all-or-nothing.
- **`taskhub`** is the role and database name, not `cronsole`. That is deliberate and permanent —
  the Docker volume holds the one thing here that cannot be rebuilt from the repo, so it was never
  renamed. See the comment at the top of `docker-compose.yml`.

The dump is small — a database with ~400 tracked tasks and a few hundred log rows is around 130 KB.

---

## Scheduling it with Cronsole

The tidy version: let Cronsole schedule its own backup, as a **native `SCRIPT` job**.

1. **New task → Cronsole → Script**
2. Interpreter **`bash`** (or `powershell` on Windows), body:

   ```bash
   cd /path/to/your/cronsole
   docker compose exec -T db pg_dump -U taskhub -d taskhub -Fc \
     > "/path/to/backups/cronsole-$(date +%Y%m%d).dump"
   ```

3. Schedule: `0 3 * * *` (daily at 03:00 UTC — Cronsole stores every schedule as UTC cron).

Two things to know before you rely on it:

- **A native job runs where the *backend* runs.** On the Dockerized stack that is inside the backend
  container, which has no Docker socket and no access to your host paths — so on that setup, run the
  backup from the host with Windows Task Scheduler or `cron` instead. On the normal host-process
  stack (what `cronsole.ps1` runs), a native job runs on your machine and this works as written.
- **A backup job that fails silently is worse than no backup job.** Point a `CHECK` task at the
  output directory, or read the run history occasionally. A `CHECK` job's failure is a fact about
  your system rather than a bug in your script, which is exactly the distinction you want here.

---

## Restoring

Restore into an **empty** database. `pg_restore` into a populated one produces a blizzard of
"already exists" errors and a half-merged result.

```bash
# 1. Stop the app so nothing writes while you work. Leave the db container up.
docker compose stop backend frontend        # or: cronsole down, on the host stack

# 2. Recreate the database empty.
docker compose exec -T db psql -U taskhub -d postgres \
  -c "DROP DATABASE IF EXISTS taskhub;" \
  -c "CREATE DATABASE taskhub OWNER taskhub;"

# 3. Restore.
docker compose exec -T db pg_restore -U taskhub -d taskhub --no-owner < cronsole-backup.dump

# 4. Bring it back up.
docker compose --profile docker up -d
```

You do **not** need to run migrations afterwards. The dump includes `_prisma_migrations`, so the
restored database already knows which migrations are applied and the `prisma migrate deploy` that
runs on boot is a no-op. (If that table were missing, boot would try to re-apply every migration
against a populated schema and fail — which is the shape of
[#90](../../troubleshooting/README.md#90-a-fresh-clones-docker-quick-start-dies-with-the-table-publicuser-does-not-exist),
one layer down.)

---

## Testing the restore — do this once, now

An untested backup is a belief. Testing it takes about a minute and does not touch your live
database, because it restores into a scratch one beside it.

```bash
# 1. Dump the live database.
docker compose exec -T db pg_dump -U taskhub -d taskhub -Fc > test.dump

# 2. Restore it into a scratch database.
docker compose exec -T db psql -U taskhub -d postgres \
  -c "DROP DATABASE IF EXISTS restore_test;" \
  -c "CREATE DATABASE restore_test OWNER taskhub;"
docker compose exec -T db pg_restore -U taskhub -d restore_test --no-owner < test.dump

# 3. Compare every table's real row count, in both databases.
Q="SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM %I', tablename, tablename),
    ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"
SQL=$(docker compose exec -T db psql -U taskhub -d taskhub -At -c "$Q")
docker compose exec -T db psql -U taskhub -d taskhub      -At -F'|' -c "$SQL ORDER BY 1" > orig.txt
docker compose exec -T db psql -U taskhub -d restore_test -At -F'|' -c "$SQL ORDER BY 1" > rest.txt
diff orig.txt rest.txt && echo "every table matches"

# 4. Clean up.
docker compose exec -T db psql -U taskhub -d postgres -c "DROP DATABASE restore_test;"
rm test.dump orig.txt rest.txt
```

> ### Why `count(*)` and not the fast way
>
> The obvious shortcut is `SELECT relname, n_live_tup FROM pg_stat_user_tables` — one query, no
> generated SQL. **It gives the wrong answer, and it gives it convincingly.** `n_live_tup` is an
> *estimate* maintained by the statistics collector, so on a database that has not been analysed
> recently it reads low or zero, while a freshly restored one has accurate stats from its own
> inserts.
>
> Run that way, this exact test reported the live database as having 0 users, 0 archives and 18
> execution logs against the restored copy's 1, 27 and 143 — a **false mismatch** on a restore that
> was perfect. The same estimate error in the other direction would have reported a match on a
> restore that was not. A verification step that can be wrong in both directions is not one.

**Then check the part row counts cannot see:** open the dashboard and confirm a platform
connection still works. That is what proves `ENCRYPTION_KEY` came across, and no count will tell
you.

---

## Verified

This procedure was run end to end against a live stack on **2026-09-11** — PostgreSQL 16.14, a
database of 404 tasks and 143 execution logs across 17 tables. The dump was 130 KB, `pg_restore`
exited 0 with no errors, and all 17 tables matched exactly on real counts. The scratch database was
dropped and the live stack verified intact afterwards.

---

<p align="center">
  <a href="../README.md">User guides</a> ·
  <a href="../../TRUST.md">Removing Cronsole completely</a> ·
  <a href="../../troubleshooting/README.md">Troubleshooting</a>
</p>
