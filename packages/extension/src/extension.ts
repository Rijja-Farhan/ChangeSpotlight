import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseLoc } from '@change-spotlight/core';
import { connectBridge, type BridgeConnection } from './bridge';
import { ChangeTracker } from './changeTracker';
import { describeBase, findRepo, type ChangeResult } from './git';
import { Gutter } from './gutter';
import { SeenController, type SeenState } from './seenController';
import { SeenStore } from './seenStore';
import type { TreeNode } from './tree';
import { ChangesTreeProvider } from './treeView';

type Status = 'noFolder' | 'noRepo' | 'gitMissing' | 'loading' | 'error' | 'noChanges' | 'ready';

let output: vscode.OutputChannel;

function setStatus(status: Status): void {
  void vscode.commands.executeCommand('setContext', 'changeSpotlight.status', status);
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Change Spotlight');
  // Register the view before anything can return early, so its welcome content always shows.
  const tree = new ChangesTreeProvider();
  const view = vscode.window.createTreeView('changeSpotlight.changes', { treeDataProvider: tree });
  context.subscriptions.push(output, tree, view);

  void start(context, tree, view);
}

async function start(context: vscode.ExtensionContext, tree: ChangesTreeProvider, view: vscode.TreeView<TreeNode>): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = folders[0];
  if (!folder) {
    output.appendLine('No workspace folder open.');
    return setStatus('noFolder');
  }
  if (folders.length > 1) output.appendLine(`Multiple workspace folders: only "${folder.name}" is tracked.`);

  setStatus('loading');
  const found = await findRepo(folder.uri.fsPath);
  if (!found.ok) {
    output.appendLine(
      found.reason === 'git-missing' ? 'git was not found on PATH; Change Spotlight is idle.' : `${folder.name} is not in a git repository; Change Spotlight is idle.`,
    );
    return setStatus(found.reason === 'git-missing' ? 'gitMissing' : 'noRepo');
  }
  const root = found.repo.root;

  const gutter = new Gutter(context.extensionUri);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'changeSpotlight.changes.focus';
  const bridge = connectBridge(found.repo.gitDir, output);
  const tracker = new ChangeTracker(found.repo);

  const render = (state: SeenState) => {
    tree.update(state);
    gutter.update(state);
    const { seen, total, untrackable } = state.totals;
    view.description = `Seen ${seen} of ${total}`;
    view.badge = total - seen > 0 ? { value: total - seen, tooltip: `${total - seen} change(s) not seen in the browser yet` } : undefined;
    status.text = `$(eye) Seen ${seen}/${total}`;
    status.tooltip = `Change Spotlight: ${seen} of ${total} changes seen in the browser, ${untrackable} not trackable. Click to show the list.`;
    status.show();
    setStatus(state.hunks.length === 0 ? 'noChanges' : 'ready');
    updateMessage(view, bridge, state);
  };
  const seen = new SeenController(new SeenStore(context.workspaceState), (msg) => output.appendLine(msg), render);

  context.subscriptions.push(
    gutter,
    status,
    tracker,
    bridge,
    vscode.window.onDidChangeVisibleTextEditors(() => gutter.apply()),
    bridge.onDidChangeConnection(() => updateMessage(view, bridge, seen.state)),
    tracker.onDidChange((result) => {
      log(result, false);
      if (!result.ok) setStatus('error');
      void seen.applyResult(result);
    }),
    bridge.onMessage(({ message }) => {
      if (message.type === 'visibility') void seen.visibility(message.page, message.seen, tracker.busy);
      if (message.type === 'click' && vscode.workspace.getConfiguration('changeSpotlight').get<boolean>('openOnClick', false)) {
        void openClicked(root, message.loc);
      }
    }),
    vscode.commands.registerCommand('changeSpotlight.refresh', async () => {
      output.show(true);
      log(await tracker.refresh(), true);
    }),
    vscode.commands.registerCommand('changeSpotlight.resetSeen', async () => {
      const branch = seen.state?.branch ?? 'this branch';
      const answer = await vscode.window.showWarningMessage(
        `Reset what you have seen on ${branch}?`,
        { modal: true, detail: 'Every change will count as not seen yet.' },
        'Reset',
      );
      if (answer !== 'Reset') return;
      await seen.reset();
      output.appendLine(`Seen progress reset for ${branch}.`);
    }),
    vscode.commands.registerCommand('changeSpotlight.openHunk', (node: TreeNode) => openHunk(root, node)),
    vscode.commands.registerCommand('changeSpotlight.markSeen', (node: TreeNode) => node.hunkId && seen.markHunk(node.hunkId, true)),
    vscode.commands.registerCommand('changeSpotlight.markUnseen', (node: TreeNode) => node.hunkId && seen.markHunk(node.hunkId, false)),
  );
  tracker.schedule();
}

/** With changes to look at but no dev server, say how to connect one. */
function updateMessage(view: vscode.TreeView<TreeNode>, bridge: BridgeConnection, state: SeenState | undefined): void {
  view.message =
    state && state.totals.total > 0 && bridge.connected() === 0
      ? 'No Vite dev server connected. Start your app (for example `pnpm dev`) with the Change Spotlight Vite plugin to count what you see.'
      : undefined;
}

async function openHunk(root: string, node: TreeNode): Promise<void> {
  if (!node.open) return;
  const { path: rel, startLine, endLine, deletion } = node.open;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, rel)));
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  const last = Math.max(1, Math.min(endLine, doc.lineCount));
  const start = new vscode.Position(Math.min(startLine, last) - 1, 0);
  const end = deletion ? start : doc.lineAt(last - 1).range.end;
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}

/** "openOnClick": show the clicked element's code without stealing focus from the browser. */
async function openClicked(root: string, value: string): Promise<void> {
  const loc = parseLoc(value);
  if (!loc) return;
  const file = path.join(root, loc.path);
  if (!fs.existsSync(file)) return;
  const position = new vscode.Position(loc.start - 1, 0);
  await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true, preserveFocus: true, selection: new vscode.Range(position, position) });
}

function log(result: ChangeResult, detailed: boolean): void {
  if (!result.ok) {
    output.appendLine(`Could not compute changes (${result.reason}): ${result.message}`);
    return;
  }
  const tracked = result.files.length - result.untracked.length;
  output.appendLine(`Base: ${describeBase(result.base)} | ${tracked} changed file(s), ${result.untracked.length} untracked`);
  for (const s of result.skipped) output.appendLine(`  skipped ${s.path}: larger than 2 MiB`);
  if (!detailed) return;
  for (const file of result.files) {
    const lines = file.hunks.reduce((n, h) => n + h.newCount, 0);
    const what = file.binary ? 'binary' : `${lines} changed line(s)`;
    output.appendLine(`  ${file.status.padEnd(8)} ${file.path}: ${what}`);
  }
}

export function deactivate(): void {}
