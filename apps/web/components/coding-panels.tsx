'use client';

import {CheckCheck, FileCode2, GitBranch, Info, Play, ShieldCheck, Square, Terminal, Trash2, X} from 'lucide-react';
import type {CodingAction, CodingCommand, CodingFile, CodingRun} from '@omnichat/types';
import {CopyButton, ErrorNotice, Select} from './ui';

export type ApprovedCommand = {program: 'node' | 'npm' | 'pnpm'; args: string[]};
const commandLabels: Record<CodingCommand['status'], string> = {queued: 'Queued', running: 'Running', complete: 'Finished', error: 'Failed', cancelled: 'Stopped'};

export function CodingTerminal({available, unavailableReason, commands, selectedCommand, program, args, dirtyCount, error, cancelling, onProgram, onArgs, onReview, onSelect, onCancel}: {
  available: boolean; unavailableReason: string; commands: CodingCommand[]; selectedCommand?: CodingCommand;
  program: ApprovedCommand['program']; args: string; dirtyCount: number; error: string | null; cancelling: boolean;
  onProgram: (program: ApprovedCommand['program']) => void; onArgs: (args: string) => void;
  onReview: () => void; onSelect: (id: string) => void; onCancel: (id: string) => void;
}) {
  return <div className="terminal-panel">
    <div className="terminal-intro"><div><ShieldCheck size={15}/><h2>Isolated project terminal</h2></div>
      <p>Saved source snapshot · no network · 60-second limit</p>
      <small>Command file changes are discarded. This terminal cannot edit your original folder.</small>
    </div>
    {!available && <div className="executor-unavailable"><Info size={15}/><div><strong>Sandbox unavailable</strong><p>{unavailableReason}</p></div></div>}
    <form className="terminal-command-form" onSubmit={event => {event.preventDefault(); onReview();}}>
      <Select label="Command program" value={program} onChange={value => onProgram(value as ApprovedCommand['program'])}>
        <option value="node">node</option><option value="npm">npm</option><option value="pnpm">pnpm</option>
      </Select>
      <input aria-label="Command arguments" value={args} placeholder="Arguments, e.g. --version" onChange={event => onArgs(event.target.value)}/>
      <button className="button primary" disabled={!available || dirtyCount > 0}><Play size={13}/>Review & run</button>
    </form>
    <ErrorNotice message={error}/>
    {dirtyCount > 0 && <p className="terminal-save-note">Save your edits before running a command.</p>}
    <div className="terminal-job-tabs">
      {commands.map(command => <button className={selectedCommand?.id === command.id ? 'active' : ''} key={command.id} onClick={() => onSelect(command.id)}>
        <span className={`command-status-dot ${command.status}`}/>{command.program} {command.args.join(' ').slice(0, 45)}
      </button>)}
    </div>
    {selectedCommand ? <>
      <div className="terminal-output-heading"><span><span className={`command-status-dot ${selectedCommand.status}`}/>{commandLabels[selectedCommand.status]}{selectedCommand.exitCode != null && ` · exit ${selectedCommand.exitCode}`}</span>
        <div><CopyButton text={selectedCommand.output} label="Copy output"/>{['queued', 'running'].includes(selectedCommand.status) && <button className="text-button" onClick={() => onCancel(selectedCommand.id)} disabled={cancelling}><Square size={11}/>Stop</button>}</div>
      </div>
      <pre className="terminal-output" aria-label="Command output">{selectedCommand.output || (['queued', 'running'].includes(selectedCommand.status) ? 'Waiting for output…' : 'The command produced no output.')}</pre>
      {selectedCommand.error && <ErrorNotice message={selectedCommand.error}/>}
    </> : <div className="terminal-empty"><span>$</span><p>No commands yet.<small>Review a command above to run it in the sandbox.</small></p></div>}
  </div>;
}

export function CodingChanges({run, files, reviewIndex, dirtyCount, pending, error, executorAvailable, onSelect, onAction, onRun}: {
  run?: CodingRun; files: CodingFile[]; reviewIndex: number; dirtyCount: number; pending: boolean; error: string | null;
  executorAvailable: boolean; onSelect: (index: number) => void; onAction: (action: 'apply' | 'reject') => void; onRun: (command: ApprovedCommand) => void;
}) {
  const actions = run?.actions || [];
  const fileActions = actions.filter(action => action.type !== 'run_command');
  const action = actions[reviewIndex];
  return <div className="review-panel">
    {run && actions.length ? <>
      <div className="review-overview">
        <div><span className="eyebrow">{run.status === 'awaiting_review' ? 'REVIEW PROPOSED CHANGES' : 'TASK PROPOSALS'}</span>
          <h2>{fileActions.length} file {fileActions.length === 1 ? 'change' : 'changes'}{actions.length > fileActions.length ? `, ${actions.length - fileActions.length} command ${actions.length - fileActions.length === 1 ? 'proposal' : 'proposals'}` : ''}</h2>
          <p>Applying saves changes to the project snapshot. Linked folders require a separate publish.</p>
        </div>
        {run.status === 'awaiting_review' && <div className="review-buttons">
          <button className="button secondary" disabled={pending} onClick={() => onAction('reject')}><X size={14}/>Reject</button>
          <button className="button primary" disabled={pending || dirtyCount > 0} onClick={() => onAction('apply')}><CheckCheck size={14}/>{fileActions.length ? 'Apply all' : 'Complete review'}</button>
        </div>}
      </div>
      {dirtyCount > 0 && <div className="review-warning"><Info size={14}/>Save or discard your unsaved edits before applying changes.</div>}
      <ErrorNotice message={error}/>
      <div className="review-file-tabs">{actions.map((proposal, index) => <button className={index === reviewIndex ? 'active' : ''} key={index} onClick={() => onSelect(index)}>
        {proposal.type === 'run_command' ? <Terminal size={13}/> : proposal.type === 'delete_file' ? <Trash2 size={13}/> : <FileCode2 size={13}/>}
        <span>{proposal.type === 'run_command' ? `${proposal.program} ${proposal.args.join(' ')}` : proposal.path}</span>
        {proposal.type === 'write_file' && <small>{proposal.baseRevision === null ? 'NEW' : 'EDIT'}</small>}
        {proposal.type === 'delete_file' && <small className="danger">DELETE</small>}
      </button>)}</div>
      {action && <ChangeReview action={action} files={files} executorAvailable={executorAvailable} onRun={onRun}/>}
      <div className="review-footnote"><ShieldCheck size={12}/>Commands require separate approval. Apply all never runs commands.</div>
    </> : <div className="editor-empty"><GitBranch size={26}/><h2>No proposals to review</h2><p>AI file changes appear here before you apply them.<br/>These are task proposals, not Git changes.</p></div>}
  </div>;
}

function ChangeReview({action, files, onRun, executorAvailable}: {action: CodingAction; files: CodingFile[]; onRun: (command: ApprovedCommand) => void; executorAvailable: boolean}) {
  if (action.type === 'run_command') return <div className="command-proposal-review">
    <Terminal size={25}/><h3>A command for your approval</h3><pre>{action.program} {action.args.join(' ')}</pre>
    <p>This runs against a temporary snapshot of saved files.<br/>No network access. Command changes are not kept.</p>
    <button className="button primary" disabled={!executorAvailable} onClick={() => onRun(action)}><Play size={14}/>Review command approval</button>
    {!executorAvailable && <p className="microcopy">The isolated executor is unavailable. Check the Terminal tab for details.</p>}
  </div>;
  const original = files.find(file => file.path === action.path);
  const conflict = action.baseRevision === null ? !!original : !original || original.revision !== action.baseRevision;
  return <div className="change-review">
    {conflict && <div className="review-warning"><Info size={14}/>This file changed after the proposal. Applying will be rejected until the task is refreshed.</div>}
    <div className="diff-columns">
      <section className="diff-before"><header><span>Current saved file</span><small>{original ? `revision ${original.revision}` : 'New file'}</small></header><pre>{original?.content || <span className="diff-empty">{original ? 'Empty file' : 'This file does not exist yet.'}</span>}</pre></section>
      <section className={`diff-after ${action.type === 'delete_file' ? 'diff-deletion' : ''}`}><header><span>{action.type === 'delete_file' ? 'Proposed removal' : 'Proposed file'}</span><small>{action.type === 'delete_file' ? 'DELETE' : action.baseRevision === null ? 'CREATE' : 'EDIT'}</small></header><pre>{action.type === 'delete_file' ? <span className="diff-empty">This file will be removed when you apply changes.</span> : action.content || <span className="diff-empty">Empty file</span>}</pre></section>
    </div>
  </div>;
}
