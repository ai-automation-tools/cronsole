<a id="gemini-top"></a>

<h1 align="center">✨ Gemini API Triggers</h1>

<p align="center">
  <em>Scheduled prompts Google runs on its own agents — the first hosted source Cronsole can act on.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-controller-4285F4?style=for-the-badge" alt="Controller">
  <img src="https://img.shields.io/badge/api-v1beta_preview-F59E0B?style=for-the-badge" alt="v1beta preview">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

A trigger is a prompt Google runs on a schedule, on one of its managed agents, in a sandbox. Give it
tools and it can search the web, run code, write files and call MCP servers you point it at.

**Two hosted sources came before this one and both are read-only, which made "hosted" look like it
meant "observer".** It does not. Every verb here reaches a real endpoint, and *Run now* is the
genuine scheduled invocation rather than something that resembles it.

## 🔌 Connecting

One API key. That is the whole setup — there are no projects or repositories to name, because a key
is scoped to one Google Cloud project and sees every trigger in it.

1. Create a key in **Google AI Studio**. The key's project needs the Generative Language API enabled;
   triggers are part of the Managed Agents preview.
2. Sources tab → **Gemini API Triggers** → paste it.

Cronsole verifies the key by listing triggers before storing it, so a bad paste fails at that click
rather than inside a sync days later. It reports the trigger count too — a working key over an empty
project reads as suspicious otherwise.

Everything arrives under a single **Gemini** category. There is nothing to break it down by.

> [!TIP]
> **The agent id is a setting with a date in it.** `antigravity-preview-05-2026` is what Google's docs
> name today, and a preview string with a date is one that will be replaced. It lives in the
> connection panel rather than in Cronsole's source, so the day creates start failing the fix is a
> text field. Clear it to go back to the shipped default.

## 🛠️ Saving an MCP server — do this first

The Gemini panel has a **Saved MCP servers** section: a name, a URL, and a token. Save one and every
trigger can reference it by name.

**Do this before creating triggers.** Without it, an MCP server has to be typed in — token and all —
for every new trigger, and again each time you change a prompt, because a Gemini trigger cannot be
edited in place. Editing means recreating.

| | Saved server | Typed into the form |
|:---|:---|:---|
| Where the token lives | Encrypted on the connection, beside your API key | Sent to Gemini, kept nowhere here |
| Second trigger using it | A checkbox | Retype everything |
| After a prompt edit | Still a checkbox | Retype everything |
| Rotating the token | One gesture across every trigger | One modal per task, from memory |

**Rotation is the reason to save one.** Edit the server, press **Push this credential to N triggers**,
and each is recreated with the new token. The result is reported **per task**, because each is a
separate operation against Google's API and some can fail while others succeed.

A trigger that also carries an *unsaved* MCP server is skipped, with its reason — Cronsole never read
that token, so rebuilding would drop it.

> [!NOTE]
> Cronsole stores a saved server's token encrypted and never returns it. There is no reveal, and no
> masked field pretending to be one. Two saved servers may not share a URL: a synced trigger reports
> only `{type, name, url}`, so two on one endpoint could not be told apart and a rotation would
> rebuild the wrong ones.

## ✍️ Creating a trigger

**New Task → Gemini.** The action field is a **prompt**, not a command — there is no executable to
fall back on, and a create with no prompt is refused rather than sent.

Open **Tools and network access** to grant reach. It starts empty and stays empty unless you open it:

- **Built-in tools** — `google_search`, `url_context`, `code_execution`, `bash`, `filesystem`,
  `file_search`, `computer_use`, `google_maps`, `tool_search`.
- **Saved servers** — checkboxes, per above.
- **One-off servers** — name, URL, optional Authorization header, for something you will use once.
- **Network allowlist** — the domains the sandbox may contact. Empty means it reaches nothing outside
  itself, which is why a trigger asked to email a report will quietly write a file instead.

> [!WARNING]
> **A tool the list offers is not always one your agent accepts.** The checkboxes come from the API's
> own supported list, but the managed agent behind your triggers can refuse some of them —
> `filesystem` is the known case. Such a trigger is created happily and then **fails in about five
> seconds** with *"Tool 'filesystem' is not allowed when interacting with this agent"*. A run that
> fails faster than the work could possibly take is a rejected configuration, not a failed attempt:
> look at the tools, not the prompt.

## 📝 Writing a prompt for an unattended agent

Three rules, each paid for by a real failed run.

1. **Never let the prompt offer a choice.** Anything phrased as a question becomes a stall — nobody
   is there to answer it at 15:00 on the 1st. Give the parameter, or tell it to pick.
2. **Always tell it to report failure explicitly.** An agent that cannot complete a step tends to
   narrate success instead. *"If the send fails, say so in your output rather than describing the
   email as sent."*
3. **Paste plain text.** A prompt copied out of a terminal can carry gutter characters (`▎`) that chop
   the instruction into fragments the agent ignores.

## 🔁 Changing one — Duplicate and Replace credentials

A trigger is **immutable once it exists**. Google's update endpoint takes a status and a display name
and rejects everything else, so *Edit schedule* and *Edit action* both read **Unsupported** — a
boundary of the preview API, not a missing feature.

**Duplicate** opens the create form filled in from this trigger. It is how you change a prompt:
duplicate, edit, delete the original. Saved servers cross as references, so nothing secret is typed
twice. A hand-typed server is dropped rather than copied hollow — Cronsole never read its token, and
a server the new trigger could not authenticate to fails later, on a schedule.

**Replace credentials** rebuilds **one** trigger with new tokens or a different tool list. The
replacement is created *before* the original is removed, so a failure leaves the working trigger
alone. A paused trigger stays paused. The task keeps its run history, favourite and collections even
though Gemini assigns a new id.

For rotating one token across *every* trigger, use **Push this credential** on the saved server
instead — not this button, task by task.

## 🎛️ What Cronsole can do here

**Sync · Run now · Enable / disable · Create (with tools, MCP servers and an allowlist) · Delete**,
plus real run outcomes feeding task health.

*Edit action* and *Edit schedule* are the two it cannot do, both for the reason above.

## 🕐 Run history — read the steps, not the status

Two lists. *Runs Cronsole performed* is usually just your own **Run now** clicks. Below it, **Runs on
the platform** is read live from Gemini and includes every scheduled run.

Click one for the output, what it cost, and **what it actually did** — the tools it used, in order.

> [!IMPORTANT]
> **Read the step list, not the status.** `completed` only means the agent finished its turn. An
> agent asked to email a report can finish `completed` having only called `write_file`. If the steps
> are `google_search` and `model_output` and nothing else, it researched and wrote and never mailed
> anything — however confidently the output text reads.

There is **no Google web page for any of this**. Triggers are managed entirely through the API;
Google's own documentation for them is programmatic only, and the Gemini app's scheduled-actions page
is a different product. Cronsole is where you see them.

## ⚠️ Things that surprise people

- **Google pauses a failing trigger for you.** After a number of consecutive failures — five by
  default — Gemini disables it. Cronsole shows that as its own health warning rather than the
  ordinary "disabled" note, because nobody chose it. Resuming clears the pause, not the cause.
- **Gemini stores a timezone; Cronsole stores UTC.** Anything Cronsole writes is UTC, so the round
  trip is exact. A trigger made elsewhere in a real zone is converted on the way in with the
  platform's original pair kept beside it — and where the conversion has no honest answer, the
  schedule reads as unavailable **with the reason**, never as a guess.
- **A dispatch timeout is not a failed dispatch.** Gemini's run endpoint holds the connection while
  the agent works, well past any sane client timeout. Cronsole answers that by asking the platform
  whether a run started since the request went out, rather than reporting a failure for a run that is
  going fine.

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| A brand-new source returns "Internal server error" the moment you open it | [#81](../../troubleshooting/README.md#81-a-brand-new-source-returns-internal-server-error-the-moment-you-open-it) |
| The prompt vanishes on first sync; *Edit schedule* fails with Google's word | [#82](../../troubleshooting/README.md#82-a-gemini-trigger-loses-its-prompt-on-the-first-sync-and-edit-schedule-fails-with-googles-word) |
| Run history is always empty, or a good run is called a failure | [#83](../../troubleshooting/README.md#83-a-gemini-trigger-runs-fine-cronsole-shows-no-run-history--then-calls-a-good-run-a-failure) |
| A run fails in five seconds with nothing to read | [#84](../../troubleshooting/README.md#84-a-gemini-run-fails-in-five-seconds-and-cronsole-says-there-is-nothing-to-read) |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="Claude_Code_Routines.md">Claude Code Routines</a> ·
  <a href="GitHub_Actions.md">Next: GitHub Actions →</a>
</p>

<p align="right">(<a href="#gemini-top">back to top</a>)</p>
