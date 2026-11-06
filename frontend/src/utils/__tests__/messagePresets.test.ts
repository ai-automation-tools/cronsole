import { describe, it, expect } from 'vitest';
import { MESSAGE_PRESETS, applyMessagePreset } from '../messagePresets';
import { emptyNativeJobValues, nativeJobIncomplete, nativeJobPayload, secretRefsIn } from '../taskEditing';

describe('Send a message presets', () => {
  it.each(MESSAGE_PRESETS.map(p => [p.label, p] as const))('%s fills a complete POST that names its secret', (_label, preset) => {
    const v = applyMessagePreset(emptyNativeJobValues(), preset);
    expect(nativeJobIncomplete(v)).toBeNull();
    expect(nativeJobPayload(v)).toMatchObject({ jobType: 'HTTP', method: 'POST', url: preset.url });
    expect(secretRefsIn(v)).toEqual([preset.secret]);
  });

  it('keeps the run settings already on the form', () => {
    const v = applyMessagePreset({ ...emptyNativeJobValues(), retries: '2' }, MESSAGE_PRESETS[0]);
    expect(nativeJobPayload(v)).toMatchObject({ policy: { retries: 2 } });
  });
});
