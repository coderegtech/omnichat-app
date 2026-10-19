'use client';

import {create} from 'zustand';

/** Shell-facing view of the mounted coding workspace. Source and draft data stay in the workspace. */
export type CodingIdeState = {
  ready: boolean;
  projectName: string;
  activeFile: string | null;
  files: {path: string}[];
  dirtyCount: number;
  language: string;
  cursor: {line: number; column: number};
  explorerOpen: boolean;
  panelOpen: boolean;
  sidebarMode: 'explorer' | 'search';
  openFile: (path: string, line?: number) => void;
  toggleExplorer: () => void;
  togglePanel: () => void;
  closeActiveFile: () => void;
  showExplorer: () => void;
  showSearch: () => void;
  showTerminal: () => void;
  showChanges: () => void;
  saveFile: () => void;
};

const noop = () => {};

export const useCodingIde = create<CodingIdeState>(() => ({
  ready: false,
  projectName: '',
  activeFile: null,
  files: [],
  dirtyCount: 0,
  language: 'Plain text',
  cursor: {line: 1, column: 1},
  explorerOpen: true,
  panelOpen: false,
  sidebarMode: 'explorer',
  openFile: noop,
  toggleExplorer: noop,
  togglePanel: noop,
  closeActiveFile: noop,
  showExplorer: noop,
  showSearch: noop,
  showTerminal: noop,
  showChanges: noop,
  saveFile: noop,
}));
