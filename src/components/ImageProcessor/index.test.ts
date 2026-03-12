import { describe, expect, it } from 'vitest';
import {
  IMAGE_PROCESSOR_FOOTER_ACTIONS,
  IMAGE_PROCESSOR_HISTORY_ACTIONS,
  IMAGE_PROCESSOR_TOOL_BUTTONS,
} from './config';

describe('ImageProcessor layout config', () => {
  it('defines icon-backed crop and smart cutout tools', () => {
    expect(IMAGE_PROCESSOR_TOOL_BUTTONS.map((button) => button.id)).toEqual([
      'crop',
      'brush-restore',
      'brush-remove',
      'auto-cutout',
    ]);
    expect(IMAGE_PROCESSOR_TOOL_BUTTONS.every((button) => button.label.length > 0)).toBe(true);
  });

  it('reduces footer actions to reimport and generate only', () => {
    expect(IMAGE_PROCESSOR_FOOTER_ACTIONS.map((action) => action.id)).toEqual([
      'reimport',
      'generate',
    ]);
  });

  it('keeps import-stage tools focused on crop and cutout only', () => {
    expect(IMAGE_PROCESSOR_TOOL_BUTTONS).toHaveLength(4);
  });

  it('exposes an undo action for import-stage cutout edits', () => {
    expect(IMAGE_PROCESSOR_HISTORY_ACTIONS.map((action) => action.id)).toEqual(['undo']);
  });
});
