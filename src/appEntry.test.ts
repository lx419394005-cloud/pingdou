import { describe, expect, it } from 'vitest';
import { resolveAppEntry } from './appEntry';

describe('resolveAppEntry', () => {
  it('always keeps the main workspace entry', () => {
    expect(resolveAppEntry('?entry=import-lab')).toBe('workspace');
  });

  it('falls back to the main workspace for unknown entries', () => {
    expect(resolveAppEntry('?entry=unknown')).toBe('workspace');
    expect(resolveAppEntry('')).toBe('workspace');
  });
});
