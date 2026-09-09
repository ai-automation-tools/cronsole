import { describe, it, expect } from 'vitest';
import { moveKey, orderBy, byStoredOrder } from '../railOrder';

describe('moveKey', () => {
  it('gives the dragged key the target index, shifting the rest', () => {
    expect(moveKey(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveKey(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('returns the same array when nothing moved', () => {
    // Identity, not equality: it is how the caller skips a write for a drop on
    // yourself or on a row that vanished mid-drag.
    const keys = ['a', 'b'];
    expect(moveKey(keys, 'a', 'a')).toBe(keys);
    expect(moveKey(keys, 'a', 'gone')).toBe(keys);
  });
});

describe('orderBy', () => {
  it('re-sorts records to the key order and drops what the keys do not name', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    expect(orderBy(items, i => i.id, ['3', '1'])).toEqual([{ id: '3' }, { id: '1' }]);
  });

  it('skips a key with no record rather than inventing one', () => {
    expect(orderBy([{ id: '1' }], i => i.id, ['gone', '1'])).toEqual([{ id: '1' }]);
  });
});

describe('byStoredOrder', () => {
  it('puts named keys first, in order, and leaves the rest to the next comparator', () => {
    const rank = byStoredOrder(['b', 'a']);
    // Two unknowns tie as NaN, which is falsy — so a `||` chain falls through
    // to the alphabetical sort instead of freezing an arbitrary order.
    const sorted = ['c', 'a', 'd', 'b'].sort((x, y) => rank(x, y) || x.localeCompare(y));
    expect(sorted).toEqual(['b', 'a', 'c', 'd']);
  });

  it('is alphabetical-only when nothing is stored', () => {
    const rank = byStoredOrder([]);
    expect(['c', 'a', 'b'].sort((x, y) => rank(x, y) || x.localeCompare(y))).toEqual([
      'a',
      'b',
      'c'
    ]);
  });
});
