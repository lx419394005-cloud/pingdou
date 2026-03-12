export type ToolButtonId = 'crop' | 'brush-restore' | 'brush-remove' | 'auto-cutout';
export type FooterActionId = 'reimport' | 'generate';
export type HistoryActionId = 'undo';

export interface ToolButtonConfig {
  id: ToolButtonId;
  label: string;
  tone: 'amber' | 'slate' | 'emerald' | 'rose' | 'sky';
}

export interface FooterActionConfig {
  id: FooterActionId;
  label: string;
}

export interface HistoryActionConfig {
  id: HistoryActionId;
  label: string;
}

export const IMAGE_PROCESSOR_TOOL_BUTTONS: ToolButtonConfig[] = [
  { id: 'crop', label: '自由裁切', tone: 'amber' },
  { id: 'brush-restore', label: '恢复笔刷', tone: 'emerald' },
  { id: 'brush-remove', label: '删除笔刷', tone: 'rose' },
  { id: 'auto-cutout', label: '自动识别', tone: 'sky' },
];

export const IMAGE_PROCESSOR_HISTORY_ACTIONS: HistoryActionConfig[] = [
  { id: 'undo', label: '撤销' },
];

export const IMAGE_PROCESSOR_FOOTER_ACTIONS: FooterActionConfig[] = [
  { id: 'reimport', label: '重新导入' },
  { id: 'generate', label: '生成图纸' },
];
