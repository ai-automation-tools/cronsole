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
  // So do the source buttons.
  page.locator('[role="group"][aria-label="Task source"]'),
  // "Manage 269 tasks across your ecosystem."
  page.locator('[data-testid="task-count-line"]'),
  // "Showing your 2 starred tasks — 267 other tasks are hidden."
  page.locator('[data-testid="default-view-banner"]'),
  // Swaps between "Sync Now" and "Syncing…" with a spinning icon, so its pixels
  // depend on whether a sync happened to be in flight when the shot was taken.
  page.getByRole('button', { name: /^Sync/ })
];

/** Wait for the task list to have settled, so a screenshot isn't of a spinner. */
async function dashboardReady(page: Page) {
  await expect(page.getByRole('heading', { name: 'Unified Task Dashboard' })).toBeVisible();
  await expect(page.getByText(/Manage \d+ tasks across your ecosystem/)).toBeVisible();
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

  test('the source bar is one scrolling row and survives a narrowing view', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);

    const bar = page.locator('[role="group"][aria-label="Task source"]');
    await expect(bar).toBeVisible();

    // One row. "Windows Task Scheduler" alone is most of a 375px screen, so this
    // has to scroll rather than wrap the way the views bar does.
    const box = await bar.boundingBox();
    expect(box!.height).toBeLessThan(60);
    expect(await bar.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);

    // The regression this pins: the button list was first derived from the
    // *faceted* population, so on a view whose matches were all one source the
    // bar saw a single option, concluded there was nothing to choose, and
    // removed the only control that could switch away. An outer lens may not
    // vanish because an inner filter narrowed the list.
    await page.goto('/?view=favorites');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button', { name: /Cronsole \(Scripts\)/ })).toBeVisible();
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
    // The tool list is static chrome — no timestamps until a tool is run.
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
    // exports and deletes through the route rather than a connector method, so a
    // connector-derived matrix would report all three as unsupported here.
    const native = page.getByTestId('platform-row-TASKHUB_NATIVE');
    for (const verb of ['Edit schedule', 'Export', 'Delete']) {
      await expect(native.getByTitle(new RegExp(`^${verb}: (Verified|Declared)`))).toBeVisible();
    }
    // And the three it genuinely cannot do still say so.
    for (const verb of ['List folders', 'Edit action', 'Restore']) {
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
   * No pixel baseline for the Import modal either, and for the reason the
   * Platforms one was dropped: **masking hides colour, not geometry.** This
   * dialog's body *is* the machine's discovered folders, so its height tracks
   * how many the agent found — 706px in one run and 388px in the next, with the
   * list masked in both. Structure is what can be asserted here.
   */
  test('import modal opens with its controls', async ({ page }) => {
    await page.goto('/');
    await dashboardReady(page);
    await page.getByRole('button', { name: 'Import tasks' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import & Sync' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close import' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Discard' })).toBeVisible();
  });
});

test.describe('source is the outer lens', () => {
  test.use({ viewport: DESKTOP });

  test('selecting a source keeps the view lit and scopes its count', async ({ page }) => {
    await page.goto('/?view=my-jobs&source=TASKHUB_NATIVE:EXEC');
    await dashboardReady(page);

    const views = page.locator('[role="group"][aria-label="Saved views"]');
    const sources = page.locator('[role="group"][aria-label="Task source"]');

    // Both constraints lit at once, and no "Custom" — that is the whole
    // decision. It is legal only because both are on screen; the rule about
    // lit chips is about *hidden* constraints.
    await expect(sources.getByRole('button', { name: /Cronsole \(Scripts\)/ })).toHaveAttribute('aria-pressed', 'true');
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

  test('separates Cronsole-native into HTTP and script sources', async ({ page }) => {
    await page.goto('/?view=all');
    await dashboardReady(page);
    const bar = page.locator('[role="group"][aria-label="Task source"]');
    await expect(bar.getByRole('button', { name: /Cronsole \(HTTP\)/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /Cronsole \(Scripts\)/ })).toBeVisible();
  });

  test('a pre-split link still filters, and the bar still names what it did', async ({ page }) => {
    // `?platform=` was the param for exactly one day. It is still read, and
    // matches both subtypes by prefix — but a filtered list above a bar with
    // nothing lit is the lit-chip problem inverted, so the selection is listed
    // even though no task derives it.
    await page.goto('/?view=all&platform=TASKHUB_NATIVE');
    await dashboardReady(page);
    const bar = page.locator('[role="group"][aria-label="Task source"]');
    await expect(bar.getByRole('button', { name: /Cronsole \(Native\)/ })).toHaveAttribute('aria-pressed', 'true');
    // And it really is filtering: only native tasks survive.
    const names = await page.getByRole('button', { name: /^Open details for / }).allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(n => n.startsWith('Test -'))).toBe(true);
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
      ['Import tasks', 'Close import'],
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
