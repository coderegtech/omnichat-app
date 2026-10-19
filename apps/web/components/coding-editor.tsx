'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import CodeMirror, {type ReactCodeMirrorRef} from '@uiw/react-codemirror';
import {EditorView} from '@codemirror/view';
import {javascript} from '@codemirror/lang-javascript';
import {json} from '@codemirror/lang-json';
import {css} from '@codemirror/lang-css';
import {html} from '@codemirror/lang-html';
import {markdown} from '@codemirror/lang-markdown';
import {python} from '@codemirror/lang-python';

const editorTheme = EditorView.theme({
  '&': {height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '12px'},
  '.cm-scroller': {fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace', lineHeight: '1.8'},
  '.cm-content': {padding: '14px 0 70px', caretColor: 'var(--text)'},
  '.cm-line': {padding: '0 14px 0 8px'},
  '.cm-gutters': {backgroundColor: 'var(--bg)', color: 'var(--muted)', borderRight: 'none'},
  '.cm-gutterElement': {minWidth: '34px'},
  '.cm-activeLineGutter, .cm-activeLine': {backgroundColor: 'var(--panel-hover)'},
  '.cm-cursor, .cm-dropCursor': {borderLeftColor: 'var(--text)'},
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {backgroundColor: 'color-mix(in srgb, var(--accent) 22%, var(--bg))'},
  '.cm-panels, .cm-tooltip': {backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line)'},
  '.cm-searchMatch': {backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)', outline: '1px solid var(--accent)'},
  '&.cm-focused': {outline: 'none'},
});

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onCursorChange: (cursor: {line: number; column: number}) => void;
  revealLine?: {line: number; token: number};
  active?: boolean;
};

/** CodeMirror is loaded only with the Projects workspace bundle. File contents remain controlled drafts. */
export function CodingEditor({path, value, onChange, onCursorChange, revealLine, active=true}: Props) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(()=>{
    if(!active)return;
    const frame=requestAnimationFrame(()=>{
      const view=ref.current?.view;if(!view)return;
      view.requestMeasure();const position=view.state.selection.main.head;
      const line=view.state.doc.lineAt(position);onCursorChange({line:line.number,column:position-line.from+1});
    });
    return()=>cancelAnimationFrame(frame);
  },[active,onCursorChange]);
  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    return () => observer.disconnect();
  }, []);
  const extensions = useMemo(() => {
    const extension = path.split('.').at(-1)?.toLowerCase();
    const language = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(extension || '')
      ? javascript({jsx: extension === 'jsx' || extension === 'tsx', typescript: extension === 'ts' || extension === 'tsx'})
      : extension === 'json' ? json()
      : extension === 'css' ? css()
      : extension === 'html' || extension === 'htm' ? html()
      : extension === 'md' || extension === 'mdx' ? markdown()
      : extension === 'py' ? python() : [];
    return [language, editorTheme, EditorView.contentAttributes.of({'aria-label': `Edit ${path}`, spellcheck: 'false', autocapitalize: 'off'})];
  }, [path]);
  useEffect(() => {
    if (!revealLine) return;
    const timer = requestAnimationFrame(() => {
      const view = ref.current?.view;
      if (!view) return;
      const line = view.state.doc.line(Math.max(1, Math.min(revealLine.line, view.state.doc.lines)));
      view.dispatch({selection: {anchor: line.from}, effects: EditorView.scrollIntoView(line.from, {y: 'center'})});
      view.focus();
    });
    return () => cancelAnimationFrame(timer);
  }, [revealLine]);

  return <div className="ide-source-editor">
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      theme={theme}
      extensions={extensions}
      indentWithTab
      basicSetup={{lineNumbers: true, foldGutter: true, highlightActiveLine: true, highlightSelectionMatches: true, searchKeymap: true, tabSize: 2}}
      onChange={onChange}
      onUpdate={update => {
        if (!active || (!update.selectionSet && !update.docChanged)) return;
        const position = update.state.selection.main.head;
        const line = update.state.doc.lineAt(position);
        onCursorChange({line: line.number, column: position - line.from + 1});
      }}
    />
  </div>;
}
