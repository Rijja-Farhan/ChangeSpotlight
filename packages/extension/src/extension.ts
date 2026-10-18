import * as vscode from 'vscode';
import { changedRanges, toRepoRelative, type LineRange } from '@change-spotlight/core';
import { connectBridge } from './bridge';
import { ChangeTracker } from './changeTracker';
import { describeBase, findRepo, type ChangeResult } from './git';
import { SeenController, type SeenState } from './seenController';
import { SeenStore } from './seenStore';

let output: vscode.OutputChannel;
let dot: vscode.TextEditorDecorationType;
let ranges = new Map<string, LineRange[]>();
let repoRoot: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Change Spotlight');
  dot = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'dot.svg'),
    gutterIconSize: 'contain',
  });
  context.subscriptions.push(output, dot, vscode.window.onDidChangeVisibleTextEditors(() => decorateVisibleEditors()));

  void start(context);
}

async function start(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = folders[0];
  if (!folder) {
    output.appendLine('No workspace folder open.');
    return;
  }
  if (folders.length > 1) output.appendLine(`Multiple workspace folders: only "${folder.name}" is tracked.`);

  const found = await findRepo(folder.uri.fsPath);
  if (!found.ok) {
    output.appendLine(
      found.reason === 'git-missing' ? 'git was not found on PATH; Change Spotlight is idle.' : `${folder.name} is not in a git repository; Change Spotlight is idle.`,
    );
    return;
  }
  repoRoot = found.repo.root;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'changeSpotlight.refresh';
  status.tooltip = 'Change Spotlight: changes shown in the browser. Click to refresh.';

  const seen = new SeenController(
    new SeenStore(context.workspaceState),
    (msg) => output.appendLine(msg),
    (state) => updateStatus(status, state),
  );
  const tracker = new ChangeTracker(found.repo);
  const bridge = connectBridge(found.repo.gitDir, output);

  context.subscriptions.push(
    status,
    tracker,
    bridge,
    tracker.onDidChange((result) => {
      log(result, false);
      ranges = result.ok ? changedRanges(result.files) : new Map();
      decorateVisibleEditors();
      void seen.applyResult(result);
    }),
    bridge.onMessage(({ message }) => {
      if (message.type === 'visibility') void seen.visibility(message.page, message.seen, tracker.busy);
    }),
    vscode.commands.registerCommand('changeSpotlight.refresh', async () => {
      output.show(true);
      log(await tracker.refresh(), true);
    }),
    vscode.commands.registerCommand('changeSpotlight.resetSeen', async () => {
      await seen.reset();
      output.appendLine('Seen progress reset for this branch.');
    }),
  );
  tracker.schedule();
}

function updateStatus(status: vscode.StatusBarItem, state: SeenState): void {
  const { seen, total } = state.totals;
  status.text = `$(eye) Seen ${seen}/${total}`;
  status.show();
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

function decorateVisibleEditors(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    const rel = repoRoot && editor.document.uri.scheme === 'file' ? toRepoRelative(editor.document.uri.fsPath, repoRoot) : null;
    const lineRanges = rel ? (ranges.get(rel) ?? []) : [];
    editor.setDecorations(
      dot,
      lineRanges.map((r) => new vscode.Range(r.start - 1, 0, r.end - 1, 0)),
    );
  }
}

export function deactivate(): void {}
