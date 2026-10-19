'use client';

import {useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode} from 'react';
import {FileCode2, Files, GitBranch, PanelBottomClose, PanelBottomOpen, PanelLeftOpen, Search, Terminal, X} from 'lucide-react';
import type {CodingFile} from '@omnichat/types';

export function ResizeHandle({axis, value, min, max, label, onChange}: {
  axis: 'x' | 'y'; value: number; min: number; max: number; label: string; onChange: (value: number) => void;
}) {
  const start = useRef({position: 0, value: 0});
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return <div
    className={`ide-resize-handle ide-resize-${axis}`}
    role="separator" tabIndex={0} aria-label={label}
    aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)}
    onPointerDown={event => {
      start.current = {position: axis === 'x' ? event.clientX : event.clientY, value};
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const delta = (axis === 'x' ? event.clientX : event.clientY) - start.current.position;
      onChange(clamp(start.current.value + (axis === 'x' ? delta : -delta)));
    }}
    onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
    onKeyDown={event => {
      const decrease = axis === 'x' ? 'ArrowLeft' : 'ArrowDown';
      const increase = axis === 'x' ? 'ArrowRight' : 'ArrowUp';
      if (event.key === decrease || event.key === increase) {
        event.preventDefault();
        onChange(clamp(value + (event.key === increase ? 20 : -20)));
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); onChange(event.key === 'Home' ? min : max);
      }
    }}
  />;
}

export function CodingFileTabs({paths, selectedPath, dirtyPaths, explorerOpen, panelOpen, onSelect, onClose, onExplorer, onPanel}: {
  paths: string[]; selectedPath: string | null; dirtyPaths: string[]; explorerOpen: boolean; panelOpen: boolean;
  onSelect: (path: string) => void; onClose: (path: string) => void; onExplorer: () => void; onPanel: () => void;
}) {
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = paths[(index + offset + paths.length) % paths.length];
    if (next) {
      onSelect(next);
      const row = event.currentTarget.closest('[role=tablist]');
      (row?.querySelector(`[data-file-index="${(index + offset + paths.length) % paths.length}"]`) as HTMLButtonElement | null)?.focus();
    }
  };
  return <div className="ide-file-tabbar">
    {!explorerOpen && <button className="icon-button" title="Show explorer" aria-label="Expand file explorer" onClick={onExplorer}><PanelLeftOpen size={15}/></button>}
    <div className="ide-file-tabs" role="tablist" aria-label="Open files">
      {paths.map((path, index) => <div className={`ide-file-tab ${selectedPath === path ? 'active' : ''}`} key={path}>
        <button role="tab" aria-selected={selectedPath === path} aria-controls="coding-editor-document" tabIndex={selectedPath === path ? 0 : -1}
          data-file-index={index} title={path} onClick={() => onSelect(path)} onKeyDown={event => moveTab(event, index)}>
          <FileCode2 size={14}/><span>{path.split('/').at(-1)}</span>{dirtyPaths.includes(path) && <i className="unsaved-dot" aria-label="Unsaved changes"/>}
        </button>
        <button className="ide-close-tab" aria-label={`Close ${path}`} title="Close tab; unsaved draft is kept" onClick={() => onClose(path)}><X size={12}/></button>
      </div>)}
      {!paths.length && <span className="ide-no-tabs"><Files size={14}/>Workspace</span>}
    </div>
    <button className="icon-button" title={panelOpen ? 'Hide bottom panel' : 'Show bottom panel'} aria-label={panelOpen ? 'Hide bottom panel' : 'Show bottom panel'} onClick={onPanel}>
      {panelOpen ? <PanelBottomClose size={15}/> : <PanelBottomOpen size={15}/>}
    </button>
  </div>;
}

export function ProjectSearch({files, drafts, onSelect}: {files: CodingFile[]; drafts: Record<string, string>; onSelect: (path: string, line: number) => void}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const needle = query.toLocaleLowerCase();
    const found: {path: string; line: number; text: string; column: number}[] = [];
    for (const file of files) {
      const lines = (drafts[file.path] ?? file.content).split('\n');
      for (let index = 0; index < lines.length; index++) {
        const text = lines[index]!;
        const column = text.toLocaleLowerCase().indexOf(needle);
        if (column !== -1) found.push({path: file.path, line: index + 1, text, column});
        if (found.length >= 200) return found;
      }
    }
    return found;
  }, [files, drafts, query]);
  return <div className="ide-project-search">
    <label className="ide-search-input"><Search size={14}/><input autoFocus type="search" aria-label="Search project files" placeholder="Search files…" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <p>Current project · includes unsaved drafts</p>
    <div className="ide-search-summary" role="status">{query.trim() ? `${results.length}${results.length === 200 ? '+' : ''} matching lines` : 'Search source file contents'}</div>
    <div className="ide-search-results">
      {results.map(result => <button key={`${result.path}:${result.line}`} onClick={() => onSelect(result.path, result.line)} title={`${result.path}:${result.line}`}>
        <span><FileCode2 size={12}/><strong>{result.path}</strong><small>{result.line}</small></span>
        <code>{result.text.slice(Math.max(0, result.column - 35), result.column)}<mark>{result.text.slice(result.column, result.column + query.length)}</mark>{result.text.slice(result.column + query.length, result.column + query.length + 75)}</code>
      </button>)}
      {!!query.trim() && !results.length && <div className="ide-search-empty">No matching text in the current project.</div>}
    </div>
  </div>;
}

export function CodingBottomPanel({open, tab, height, pendingChanges, runningCommand, onTab, onToggle, onResize, children}: {
  open: boolean; tab: 'review' | 'terminal'; height: number; pendingChanges: number; runningCommand: boolean;
  onTab: (tab: 'review' | 'terminal') => void; onToggle: () => void; onResize: (height: number) => void; children: ReactNode;
}) {
  return <section className={`ide-bottom-panel ${open ? 'open' : 'collapsed'}`} style={{'--ide-panel-height': `${height}px`} as CSSProperties} aria-label="Project tools">
    {open && <ResizeHandle axis="y" value={height} min={180} max={700} label="Resize bottom panel" onChange={onResize}/>}
    <div className="ide-panel-tabs">
      <div role="tablist" aria-label="Project tools">
        <button role="tab" aria-selected={open && tab === 'terminal'} className={open && tab === 'terminal' ? 'active' : ''} onClick={() => onTab('terminal')}><Terminal size={14}/>Terminal{runningCommand && <span className="status-orb online" aria-label="Command running"/>}</button>
        <button role="tab" aria-selected={open && tab === 'review'} className={open && tab === 'review' ? 'active' : ''} onClick={() => onTab('review')}><GitBranch size={14}/>Changes{pendingChanges > 0 && <span className="tab-count">{pendingChanges}</span>}</button>
      </div>
      <button className="icon-button" aria-label={open ? 'Collapse bottom panel' : 'Expand bottom panel'} title={open ? 'Collapse panel' : 'Expand panel'} onClick={onToggle}>{open ? <X size={14}/> : <PanelBottomOpen size={14}/>}</button>
    </div>
    {open && <div className="ide-panel-body" role="tabpanel">{children}</div>}
  </section>;
}
