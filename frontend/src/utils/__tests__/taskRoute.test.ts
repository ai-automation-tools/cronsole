import { describe, it, expect } from 'vitest';
import { taskDetailRoute, taskDetailReturn } from '../taskRoute';

// The bug this pins: the dashboard slice is the URL query, so a detail route
// that drops it resets the list behind the modal and closes onto All sources.
describe('taskDetailRoute', () => {
  it('carries the dashboard query onto the detail URL', () => {
    const r = taskDetailRoute('t1', { pathname: '/', search: '?collection=ai-lab&status=any' });
    expect(r.to).toEqual({ pathname: '/tasks/t1', search: '?collection=ai-lab&status=any' });
  });

  it('remembers the screen it was opened from, query included', () => {
    const r = taskDetailRoute('t1', { pathname: '/', search: '?collection=ai-lab' });
    expect(r.options.state.from).toBe('/?collection=ai-lab');
  });

  it('remembers a non-dashboard origin, so Tools comes back to Tools', () => {
    const r = taskDetailRoute('t1', { pathname: '/tools', search: '' });
    expect(r.to).toEqual({ pathname: '/tasks/t1', search: '' });
    expect(r.options.state.from).toBe('/tools');
  });
});

describe('taskDetailReturn', () => {
  it('goes back to the remembered origin', () => {
    expect(taskDetailReturn({ search: '?collection=ai-lab', state: { from: '/?collection=ai-lab' } }))
      .toBe('/?collection=ai-lab');
    expect(taskDetailReturn({ search: '', state: { from: '/tools' } })).toBe('/tools');
  });

  // A reload drops history state. The query the detail URL carries still names
  // the slice, so the fallback is the dashboard on that slice — not a bare one.
  it('falls back to the dashboard on the carried query when state is gone', () => {
    expect(taskDetailReturn({ search: '?collection=ai-lab' }))
      .toEqual({ pathname: '/', search: '?collection=ai-lab' });
    expect(taskDetailReturn({ search: '', state: null }))
      .toEqual({ pathname: '/', search: '' });
  });

  // `from` is history state, which a page can write. It may name a path inside
  // this app and nothing else.
  it('refuses an origin that is not an in-app path', () => {
    expect(taskDetailReturn({ search: '', state: { from: 'https://example.com' } }))
      .toEqual({ pathname: '/', search: '' });
    expect(taskDetailReturn({ search: '', state: { from: '//example.com' } }))
      .toEqual({ pathname: '/', search: '' });
    expect(taskDetailReturn({ search: '', state: { from: 42 } }))
      .toEqual({ pathname: '/', search: '' });
  });
});
