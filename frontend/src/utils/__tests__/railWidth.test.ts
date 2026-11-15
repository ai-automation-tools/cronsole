import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampRailWidth,
  readRailWidth,
  writeRailWidth,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_KEY,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN
} from '../railWidth';

beforeEach(() => window.localStorage.clear());

describe('railWidth', () => {
  it('clamps to the limits and rounds to a whole pixel', () => {
    expect(clampRailWidth(10)).toBe(RAIL_WIDTH_MIN);
    expect(clampRailWidth(10_000)).toBe(RAIL_WIDTH_MAX);
    expect(clampRailWidth(300.6)).toBe(301);
  });

  it('round-trips a width through storage', () => {
    writeRailWidth(400);
    expect(readRailWidth()).toBe(400);
  });

  // Reset is a removal, so a later change to the default reaches everyone who
  // never moved the edge rather than freezing the old default in their store.
  it('stores the default as an absence', () => {
    writeRailWidth(400);
    writeRailWidth(RAIL_WIDTH_DEFAULT);
    expect(window.localStorage.getItem(RAIL_WIDTH_KEY)).toBeNull();
    expect(readRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
  });

  it('falls back to the default on anything unreadable, never a zero-width rail', () => {
    window.localStorage.setItem(RAIL_WIDTH_KEY, 'wide');
    expect(readRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
    window.localStorage.setItem(RAIL_WIDTH_KEY, '0');
    expect(readRailWidth()).toBe(RAIL_WIDTH_MIN);
  });
});
