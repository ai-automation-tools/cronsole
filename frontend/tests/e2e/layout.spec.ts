import { expect, test, type Page } from '@playwright/test';

/**
 * Layout and visual-regression coverage for the dense surfaces.
 *
 * The UI is tight enough that a spacing regression is a real regression, and
 * until now nothing would have caught one. This spec is that net — but it is
 * built around a constraint worth stating plainly, because ignoring it is how
 * visual suites end up disabled:
 *
 * **A screenshot of live data is not a regression test.** This dashboard renders
 * 269 real tasks with per-card wall-clock timestamps and relative times that tick
 * every minute. A full-page baseline over that fails on the next minute, every
 * time, and a suite that cries wolf gets ignored — which is strictly worse than
 * having none.
 *
 * So the coverage is split by what each part can honestly assert:
 *
 *  - **Pixels, for chrome that does not move** — the header, view bar, filter
 *    zone, and the modals, which are form layout rather than data. Volatile
 *    regions inside them (the health strip's timestamps, view counts) are
 *    masked, so a spacing change fails and a clock tick does not.
 *  - **Invariants, for everything else** — no horizontal overflow at 375px, the
 *    sticky toolbar surviving a scroll, tap targets reaching 44px. These are
 *    deterministic regardless of what the data does, and they are the assertions
 *    that would actually have caught the mobile problems this pass fixed.
 *
 * The 375px half of this file also *is* the verification the roadmap flagged as
 * never having been done: the browser-resize route could not reach the tab, so
 * the check kept being reasoned about rather than run. Here it runs.
 *
 * Baselines are per-platform (Playwright's default snapshot suffix), so a
 * Windows dev machine and a Linux runner keep their own — font rasterization
 * differs enough that one set could never serve both. A new surface writes its
 * baseline on first run and fails that run by design; re-run to confirm.
 *
 * Requires the dev stack up: `pwsh scripts/cronsole.ps1 up`.
 */

const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

/**
 * Regions whose text tracks the clock or the machine's real task list. Masked
 * out of every baseline — otherwise the suite fails on the next minute, and a
 * suite that fails for no reason is a suite that gets switched off.
 */
const volatile = (page: Page) => [
  // Entirely relative times ("Synced 19h ago").
  page.locator('[data-testid="health-strip"]'),
  // View chips carry live counts.
  page.locator('[role="group"][aria-label="Saved views"]'),
  // So does every row of the source rail — and its tree shape tracks the real
  // machine's folders, so it is data, not chrome. (This used to mask
  // `[aria-label="Task source"]`, the horizontal source *bar* the rail replaced
  // on 2026-08-15; the selector matched nothing afterwards, which masks nothing
  // and fails silently — a mask for an element that no longer exists is
  // indistinguishable from no mask at all.)
  page.getByTestId('source-rail'),
  // "Manage 269 tasks across your ecosystem."
  page.locator('[data-testid="task-count-line"]'),
  // Swaps between "Sync" and "Syncing…" with a spinning icon, so its pixels
  // depend on whether a sync happened to be in flight when the shot was taken.
  page.getByRole('button', { name: /^Sync/ }),
  // "Clear 2 Missing" carries a live count, and the button only exists at all
  // when something IS missing — so it changes width with the digit count and
  // vanishes entirely when the list is clean, shifting every button beside it.
  // Found by running the whole suite in one go: the mock-agent spec changes the
  // missing count, so this passed alone and failed in sequence. A test that only
  // fails when run with its siblings is the kind that gets marked flaky and
  // skipped, when the real fault is unmasked live data inside the chrome.
  page.getByRole('button', { name: /Missing$/ }),
  // The Tools tab's Task health tiles — four live counts. The comment on that
  // test called the tool list "static chrome, no timestamps until a tool is
  // run", which stopped being true when the health summary moved onto the card.
  page.getByTestId('task-health-counts'),
  // The task cards themselves. They entered the first viewport when the
  // dashboard's default changed from Favorites to All, bringing per-card
  // "Last updated" clocks with them — and the E2E suite re-syncs one of those
  // tasks during its own run, so the value moves *because the suite ran*.
  // This is the file's own rule applied to itself: screenshot the chrome,
  // assert the content.
  page.locator('[data-testid="task-list"]')
];

/**
 * Wait for the task list to have settled, so a screenshot isn't of a spinner.
 *
 * **Anchored on the count line, not the heading.** It used to wait for a heading
 * reading "Unified Task Dashboard", which the 2026-08-15 redesign replaced with a
 * heading that names the current scope — "All Tasks", "Windows Task Scheduler",
 * or a collection's name. Every test in this file calls this helper, so that one
 * stale selector failed all 18 of them, and nothing noticed because `test:e2e`
 * is not in CI. Pick anchors that do not encode a label someone will reasonably
 * change.
 */
async function dashboardReady(page: Page) {
  await expect(page.getByTestId('task-count-line')).toBeVisible();
  await expect(page.getByTestId('task-list')).toBeVisible();
}

test.describe('mobile layout — 375px', () => {
  test.use({ viewport: MOBILE });

  test('nothing overflows the viewport horizontally', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    // The whole point of the mobile pass. A single element wider than the
    // viewport makes the entire page pan sideways, which on a phone reads as the
    // app being broken rather than as one chip being too wide.
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main');
      const wide = [...document.querySelectorAll('main *')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= window.innerWidth + 1) return false;
          // Ignore anything inside a deliberate horizontal scroller — a row that
          // scrolls inside its own box is the fix, not the bug. The walk goes all
          // the way up, not one level: the view chips sit two wrappers deep
          // inside the saved-views scroller, so a parent-only check reported the
          // mobile fix as the mobile bug.
          for (let a: Element | null = el; a && a.tagName !== 'MAIN'; a = a.parentElement) {
            const ox = getComputedStyle(a).overflowX;
            if (ox === 'auto' || ox === 'scroll') return false;
          }
          return true;
        })
        .slice(0, 5)
        .map(el => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 70)}`);
      return {
        bodyScrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
        mainScrolls: main ? main.scrollWidth > main.clientWidth + 1 : false,
        wide
      };
    });

    expect(overflow.wide).toEqual([]);
    expect(overflow.bodyScrolls).toBe(false);
    expect(overflow.mainScrolls).toBe(false);
  });

  test('the saved views bar is one scrolling row, not four stacked ones', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    const bar = page.locator('[role="group"][aria-label="Saved views"]');
    await expect(bar).toBeVisible();

    const box = await bar.boundingBox();
    // Six wrapped chips stacked to roughly four rows (~150px). One row of chips
    // plus its scroll padding is well under 60.
    expect(box!.height).toBeLessThan(60);

    // And it really does scroll rather than clipping its tail off.
    const scrollable = await bar.evaluate(el => el.scrollWidth > el.clientWidth);
    expect(scrollable).toBe(true);
  });

  /*
    The source rail on a phone. This replaces a test for the horizontal source
    *bar*, which the 2026-08-15 redesign removed — the rail is two levels deep
    and cannot be a scrolling row, so it becomes a drawer at this width.

    None of this was ever rendered below `md` before now. It shipped with its
    responsive classes written and read back as correct, which is exactly the
    kind of "verified" that jsdom cannot contradict: it does not evaluate media
    queries, so `hidden md:flex` is invisible to the unit suite and every test
    passes whether the class is right or wrong.
  */
  test('the rail is a drawer, not a column', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    // The docked <aside> must be gone — 288px of rail on a 375px screen leaves
    // 87px for the task list.
    await expect(page.locator('aside').getByTestId('source-rail')).toBeHidden();

    // And the way in is beside the heading, not in the app toolbar: it re-scopes
    // the list, so it belongs next to the list.
    const open = page.getByRole('button', { name: 'Open sources' });
    await expect(open).toBeVisible();

    await open.click();
    const drawer = page.getByRole('dialog', { name: 'Sources' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('source-rail')).toBeVisible();
  });

  test('picking a source closes the drawer and re-scopes the list', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);
    await page.getByRole('button', { name: 'Open sources' }).click();

    const drawer = page.getByRole('dialog', { name: 'Sources' });
    await drawer.getByRole('button', { name: /^Windows Task Scheduler/ }).click();

    // Leaving it open would cover the result of the tap that closed the question.
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/source=WINDOWS_TASK_SCHEDULER/);
    // The breadcrumb is the only thing naming the scope at this width — the rail
    // that would otherwise show it is behind the drawer. It shares the element
    // that otherwise carries the task count, replacing it rather than stacking.
    await expect(page.getByTestId('task-count-line')).toContainText('Windows Task Scheduler');
  });

  test('Escape closes the drawer', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);
    await page.getByRole('button', { name: 'Open sources' }).click();

    const drawer = page.getByRole('dialog', { name: 'Sources' });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('the app toolbar fits, and its sections stay reachable', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    // Five sections across 375px only works because the labels drop below `sm`.
    // Assert the outcome (it fits, on one row) rather than the class.
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav).toBeVisible();

    const box = (await nav.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(MOBILE.width);
    expect(box.height).toBeLessThan(60);

    // Every section is still a real, named, tappable control — dropping the
    // visible label must not drop the accessible one.
    for (const name of ['Dashboard', 'Templates', 'Platforms', 'Tools', 'Settings']) {
      const section = nav.getByRole('button', { name });
      await expect(section).toBeVisible();
      const b = (await section.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(36);
    }
  });

  test('the filter toolbar stays reachable after scrolling the list', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    const filters = page.getByRole('button', { name: 'Filters' });
    await expect(filters).toBeVisible();

    // Scroll well past the fold. On a phone the filter zone is the only way back
    // out of a filtered list, so it has to still be there.
    await page.locator('main').evaluate(el => el.scrollTo(0, 2000));
    await expect(filters).toBeInViewport();
  });

  test('New Task is reachable as the floating action button', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    const fab = page.getByRole('button', { name: 'New task' });
    await expect(fab).toBeVisible();

    // The FAB replaces the header button at this width rather than joining it —
    // two ways to create a task is one too many.
    await expect(page.getByRole('button', { name: 'New Task', exact: true })).toBeHidden();

    const box = await fab.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  /*
    The four native job-type buttons, which are a `grid-cols-2 sm:grid-cols-4`.
    Roadmap item 0.4: written and read back as correct on 2026-08-15, never
    rendered at this width. Two rows of two is the intended layout here — what
    must not happen is four squeezed onto one row (unreadable) or any of them
    escaping the dialog.
  */
  test('the native job types fit as two rows of two', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);
    await page.getByRole('button', { name: 'New task' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The four job types, by the labels the UI actually uses — each says what the
    // task will *do*, not which enum it stores.
    const names = ['Call a URL', 'Run a program', 'Write a script', 'Check something'];
    const boxes = [];
    for (const name of names) {
      const b = dialog.getByRole('button', { name, exact: true });
      await expect(b).toBeVisible();
      boxes.push({ name, box: (await b.boundingBox())! });
    }

    // Nothing escapes the viewport.
    for (const { name, box } of boxes) {
      expect(box.x + box.width, `${name} overflows`).toBeLessThanOrEqual(MOBILE.width + 1);
    }

    // Two distinct rows: the first two share a top edge, the third sits below.
    const tops = boxes.map(b => Math.round(b.box.y));
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBeGreaterThan(tops[0]);
    expect(tops[2]).toBe(tops[3]);

    // And each stays a real tap target rather than being crushed to fit. 40 is
    // not an abstract guideline here: it is the height of the platform picker
    // one field up, the same "pick one of N" control. These shipped at 34 against
    // that 42 and this assertion is what found it.
    for (const { name, box } of boxes) {
      expect(box.height, `${name} too short to tap`).toBeGreaterThanOrEqual(40);
    }
  });

  /*
    Collections (2026-08-16) reach the phone through the same drawer as the
    sources, and they were never rendered here either. The rail row is the only
    way to navigate to one; the bookmark button on a task is the only way to fill
    one — so if either is unreachable at this width the feature does not exist on
    a phone.
  */
  test('collections are reachable in the drawer and on a task', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    await page.getByRole('button', { name: 'Open sources' }).click();
    const drawer = page.getByRole('dialog', { name: 'Sources' });

    // The create/manage affordance sits at the foot of the rail and must be
    // inside the drawer's scroll area, not below its bottom edge.
    const manage = drawer.getByRole('button', { name: /collections?$/i });
    await expect(manage).toBeVisible();
    await expect(manage).toBeInViewport();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // The per-task control: open the first task and find the bookmark menu.
    await page.getByRole('button', { name: /^Open details for / }).first().click();
    const taskModal = page.getByRole('dialog');
    await expect(taskModal).toBeVisible();

    const bookmark = taskModal.getByRole('button', { name: /collection/i }).first();
    await expect(bookmark).toBeVisible();
    const box = (await bookmark.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test('dashboard chrome', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);
    await expect(page.locator('main')).toHaveScreenshot('dashboard-mobile.png', {
      mask: volatile(page),
      // Only the first viewport — below it is live task data that changes.
      clip: { x: 0, y: 0, width: MOBILE.width, height: 380 }
    });
  });
});

test.describe('desktop layout — 1280px', () => {
  test.use({ viewport: DESKTOP });

  test('dashboard chrome', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);
    await expect(page.locator('main')).toHaveScreenshot('dashboard-desktop.png', {
      mask: volatile(page),
      clip: { x: 0, y: 0, width: DESKTOP.width, height: 300 }
    });
  });

  test('templates library chrome', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Templates', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Schedule Template Library' })).toBeVisible();
    await expect(page.locator('main')).toHaveScreenshot('templates-desktop.png', {
      mask: volatile(page),
      clip: { x: 0, y: 0, width: DESKTOP.width, height: 320 }
    });
  });

  test('tools tab', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Tools', { exact: true }).first().click();
    // Static chrome again, and this time for a structural reason rather than by
    // luck: every tool card is closed on a fresh profile, so the one piece of
    // live data on this tab — Task health's four counts — has not been fetched.
    // `volatile` still masks it, for the run where someone opens a card first.
    await expect(page.locator('main')).toHaveScreenshot('tools-desktop.png', {
      mask: volatile(page),
      clip: { x: 0, y: 0, width: DESKTOP.width, height: 420 }
    });
  });

  /**
   * No pixel baseline for Platforms, on purpose.
   *
   * Nearly every glyph on that page is live evidence — health state, the reason
   * a platform is degraded, four relative timestamps per row — and the naming of
   * the timed-out verb changes between polls. Masking it all would leave a
   * baseline of the page's empty frame, which pins nothing and still breaks
   * whenever a row's height moves. The rules the page exists to express are
   * structural, so they are asserted structurally.
   */
  test('platforms matrix states each capability as evidence', async ({ page }) => {
    await page.goto('/platforms');
    await expect(page.getByRole('heading', { name: 'Platforms' })).toBeVisible();

    // The two platforms that actually work must be present — their absence was
    // the original defect: the tab listed only bookmarks to Claude/ChatGPT/Gemini.
    await expect(page.getByText('Windows Task Scheduler')).toBeVisible();
    await expect(page.getByText('Cronsole-native')).toBeVisible();

    await page.getByRole('button', { name: 'Show the evidence behind each capability' }).first().click();
    const table = page.locator('table').first();
    await expect(table).toBeVisible();

    // Every verb is listed, and every one carries a state — a cell may not be
    // blank, because a blank cell reads as "fine" and is really "unmeasured".
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(10);
    for (const state of await rows.locator('td:nth-child(2)').allInnerTexts()) {
      expect(['VERIFIED', 'DECLARED', 'UNSUPPORTED']).toContain(state.trim());
    }

    // The route-level carve-out, end to end: Cronsole-native reschedules,
    // exports, deletes AND edits its action through the route rather than a
    // connector method, so a connector-derived matrix would report all four as
    // unsupported here. ("Edit action" joined the list when `PATCH
    // /api/tasks/:id/job` shipped — the DB row IS the task, so native changes
    // what it runs with no agent and while one is offline. This assertion still
    // demanded Unsupported for it, which was true of an older build.)
    const native = page.getByTestId('platform-row-TASKHUB_NATIVE');
    for (const verb of ['Edit schedule', 'Export', 'Delete', 'Edit action']) {
      await expect(native.getByTitle(new RegExp(`^${verb}: (Verified|Declared)`))).toBeVisible();
    }
    // And the two it genuinely cannot do still say so — there is no folder
    // hierarchy to list and no portable file to restore from.
    for (const verb of ['List folders', 'Restore']) {
      await expect(native.getByTitle(new RegExp(`^${verb}: Unsupported`))).toBeVisible();
    }
  });

  test('new task modal', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);
    await page.getByRole('button', { name: 'New Task', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveScreenshot('modal-new-task.png');
  });

  /**
   * No pixel baseline for the folder picker either, and for the reason the
   * Platforms one was dropped: **masking hides colour, not geometry.** This
   * dialog's body *is* the machine's discovered folders, so its height tracks
   * how many the agent found — 706px in one run and 388px in the next, with the
   * list masked in both. Structure is what can be asserted here.
   */
  test('Import takes a file; Sync opens the folder picker', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    // Import is the file button now. It creates a task — and it says so before
    // anything is picked, which is the half of the old chooser worth keeping.
    await page.getByRole('button', { name: 'Import a task file' }).click();
    const importDialog = page.getByRole('dialog');
    await expect(importDialog.getByRole('heading', { name: 'Import a task file' })).toBeVisible();
    await expect(importDialog.getByText(/This creates a task/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(importDialog).toBeHidden();

    // Adopting what is already on the machine is the second gesture under Sync,
    // and the only one that can start tracking a folder.
    await page.getByRole('button', { name: 'Sync options' }).click();
    await page.getByRole('menuitem', { name: /Add tasks from this machine/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add tasks from this machine' })).toBeVisible();
    await expect(dialog.getByText(/Nothing is created/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Discard' })).toBeVisible();
  });
});

test.describe('source is the outer lens', () => {
  test.use({ viewport: DESKTOP });

  test('selecting a source keeps the view lit and scopes its count', async ({ page }) => {
    await page.goto('/?view=my-jobs&source=TASKHUB_NATIVE:EXEC');
    await dashboardReady(page);

    const views = page.locator('[role="group"][aria-label="Saved views"]');
    // The rail replaced the horizontal source bar on 2026-08-15, and it marks
    // selection with `aria-current` rather than `aria-pressed` — it is
    // navigation, not a toggle. The rule under test is unchanged.
    const rail = page.getByTestId('source-rail');

    // Both constraints lit at once, and no "Custom" — that is the whole
    // decision. It is legal only because both are on screen; the rule about
    // lit chips is about *hidden* constraints.
    await expect(rail.getByRole('button', { name: /^Programs/ })).toHaveAttribute('aria-current', 'true');
    await expect(views.getByRole('button', { name: /^My jobs/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(views.getByText('Custom')).toHaveCount(0);

    // And the view's count is taken *inside* the source. Reading "My jobs 88"
    // above a list of one is the same broken promise as "Showing All 269" above
    // two rows — a count predicts the click, and the click lands in the source.
    const rows = await page.getByRole('button', { name: /^Open details for / }).count();
    const label = await views.getByRole('button', { name: /^My jobs/ }).innerText();
    expect(label).toContain(String(rows));
  });
});

test.describe('the source split', () => {
  test.use({ viewport: DESKTOP });

  test('lists every native job type as its own level-2 row', async ({ page }) => {
    await page.goto('/?view=all');
    await dashboardReady(page);
    const rail = page.getByTestId('source-rail');

    // They used to be top-level sources; they are the platform's own grouping
    // now, one level down. All four are listed **whether or not any task uses
    // one** — a native job type is structure, not observed data, so an empty
    // *Checks* must still be navigable rather than reading as a missing feature.
    await rail.getByRole('button', { name: /^Cronsole \(Native\)/ }).click();
    for (const label of ['HTTP jobs', 'Programs', 'Scripts', 'Checks']) {
      await expect(rail.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
  });

  test('a pre-split link still filters, and the rail still names what it did', async ({ page }) => {
    // `?platform=` was the param for exactly one day. It is still read, and
    // matches every subtype by prefix — but a filtered list above a rail with
    // nothing lit is the lit-chip problem inverted, so the selection is listed
    // even though no task derives it.
    await page.goto('/?view=all&platform=TASKHUB_NATIVE');
    await dashboardReady(page);
    const rail = page.getByTestId('source-rail');
    await expect(rail.getByRole('button', { name: /^Cronsole \(Native\)/ })).toHaveAttribute('aria-current', 'true');
    // And it really is filtering. Asserted against the rail's own count rather
    // than against task NAMES: this used to require every row to start with
    // "Test -", which only held while the E2E fixtures were the only native
    // tasks on the machine, and broke the moment a real one existed. Comparing
    // the list to the count beside the control that produced it also re-checks
    // the rule that a rail count predicts its click.
    const railCount = Number(
      (await rail
        .getByRole('button', { name: /^Cronsole \(Native\)/ })
        .getAttribute('aria-label'))!.match(/(\d+) task/)![1]
    );
    const rows = await page.getByRole('button', { name: /^Open details for / }).count();
    expect(rows).toBe(railCount);
  });

  test('the All view exists and is the widest lens', async ({ page }) => {
    await page.goto('/?view=all');
    await dashboardReady(page);
    const views = page.locator('[role="group"][aria-label="Saved views"]');
    await expect(views.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    // Nothing is withheld, so the Filters trigger carries no count — a badge
    // that fires when nothing is constrained is one people learn to ignore.
    await expect(page.getByRole('button', { name: 'Filters' })).toHaveText(/^Filters/);
  });
});

test.describe('accessible names on icon-only controls', () => {
  test.use({ viewport: DESKTOP });

  // Not a screenshot, but it belongs with the rest of the layout net: an unnamed
  // icon button is invisible to a screen reader and no pixel baseline can see it.
  test('every modal close button is named', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    for (const [opener, close] of [
      ['New Task', 'Close new task'],
      ['Import a task file', 'Close import'],
      ['Help Center', 'Close help center']
    ] as const) {
      await page.getByRole('button', { name: opener, exact: true }).click();
      const dialog = page.getByRole('dialog');
      // `exact` matters: the Help modal also has a footer "Close Help Center"
      // button, and Playwright's default name matching is substring-and-
      // case-insensitive, so both would match and the locator would be strict-mode
      // ambiguous. The one being asserted is the icon-only header control.
      await expect(dialog.getByRole('button', { name: close, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });

  test('a task card is reachable and named by keyboard', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    // The card is a clickable <div>; its title is the real control. Without one,
    // the dashboard's primary action is mouse-only.
    const opener = page.getByRole('button', { name: /^Open details for / }).first();
    await expect(opener).toBeVisible();
    await opener.focus();
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
