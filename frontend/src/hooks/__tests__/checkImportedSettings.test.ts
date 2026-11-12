import { describe, it, expect } from 'vitest';
import { checkImportedSettings, DEFAULT_SETTINGS } from '../useSettings';

describe('checkImportedSettings', () => {
  it('accepts its own export unchanged', () => {
    const checked = checkImportedSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
    expect(checked?.dropped).toEqual([]);
    expect(checked?.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses a file that is not a settings object', () => {
    for (const raw of [null, 42, 'grid', [], [{ defaultView: 'list' }], {}, { name: 'a task export' }]) {
      expect(checkImportedSettings(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('keeps what fits and names what does not', () => {
    const checked = checkImportedSettings({
      timezone: 'UTC',
      lastImportCategories: ['AI-Lab'],
      savedViews: 'not a list',        // would crash every .map over it
      defaultView: 'spreadsheet',      // no such view: the dashboard would render nothing
      confirmBeforeRun: 'yes',
      somethingNewer: true
    });
    expect(checked?.settings).toEqual({ timezone: 'UTC', lastImportCategories: ['AI-Lab'] });
    expect(checked?.dropped.sort()).toEqual(['confirmBeforeRun', 'defaultView', 'savedViews', 'somethingNewer']);
  });
});
