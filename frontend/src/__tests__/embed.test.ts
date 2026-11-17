import { describe, expect, it, vi } from 'vitest';
import { embedParent, shellTheme, tellShell } from '../utils/embed';
import { parseFrameAncestors } from '../utils/frameAncestors';

const HUB = 'http://localhost:4273';
const fakeParent = () => ({ postMessage: vi.fn() }) as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
const fakeWin = (parent: Window | 'self', search: string) => {
  const win = { location: { search } } as unknown as Window & { parent: Window };
  win.parent = parent === 'self' ? win : parent;
  return win;
};

describe('suite embed contract', () => {
  it('parses VITE_FRAME_ANCESTORS to origins and drops anything else', () => {
    expect(parseFrameAncestors(' http://localhost:4273/ , *, javascript:alert(1);x, http://127.0.0.1:4273')).toEqual([
      HUB,
      'http://127.0.0.1:4273',
    ]);
    expect(parseFrameAncestors(undefined)).toEqual([]);
  });

  it('embeds only when framed and asked to', () => {
    const parent = fakeParent();
    expect(embedParent(fakeWin(parent, '?embed=1'))).toBe(parent);
    expect(embedParent(fakeWin(parent, '?view=mine'))).toBeNull();
    expect(embedParent(fakeWin('self', '?embed=1'))).toBeNull();
  });

  it('posts versioned messages to each listed origin and nowhere without a list', () => {
    const parent = fakeParent();
    tellShell(parent, { type: 'ready', app: 'cronsole' }, [HUB]);
    expect(parent.postMessage).toHaveBeenCalledWith({ suite: 1, contract: 1, type: 'ready', app: 'cronsole' }, HUB);
    tellShell(parent, { type: 'route', path: '/' }, []);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });

  it('takes a theme only from the parent, at a listed origin', () => {
    const parent = fakeParent();
    const msg = (init: { source?: unknown; origin?: string; data?: unknown }) =>
      ({ source: parent, origin: HUB, data: { suite: 1, type: 'theme', value: 'light' }, ...init }) as unknown as MessageEvent;
    expect(shellTheme(msg({}), parent, [HUB])).toBe('light');
    expect(shellTheme(msg({ origin: 'http://evil.test' }), parent, [HUB])).toBeNull();
    expect(shellTheme(msg({ source: fakeParent() }), parent, [HUB])).toBeNull();
    expect(shellTheme(msg({ data: { suite: 1, type: 'theme', value: 'dracula' } }), parent, [HUB])).toBeNull();
    expect(shellTheme(msg({}), null, [HUB])).toBeNull();
  });
});
