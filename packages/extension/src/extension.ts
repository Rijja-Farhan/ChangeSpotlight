import * as path from 'node:path';
import * as vscode from 'vscode';
import { startBridgeClient } from './bridge';
import { changedLines, repoRoot, type ChangedLines } from './git';

let output: vscode.OutputChannel;
let dot: vscode.TextEditorDecorationType;
let lastResult: { root: string; changes: ChangedLines } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Change Spotlight');
  dot = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'dot.svg'),
    gutterIconSize: 'contain',
  });

  context.subscriptions.push(
    output,
    dot,
    vscode.commands.registerCommand('changeSpotlight.spike.showChanges', showChanges),
    // Editors opened after the command ran should get their dots too.
    vscode.window.onDidChangeVisibleTextEditors(() => decorateVisibleEditors()),
  );

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    repoRoot(folder.uri.fsPath).then(
      (root) => context.subscriptions.push(startBridgeClient(root, output)),
      () => output.appendLine('Not a git repository; browser bridge not started.'),
    );
  }
}

async function showChanges(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    output.appendLine('No workspace folder open.');
    return;
  }
  try {
    const root = await repoRoot(folder.uri.fsPath);
    const changes = await changedLines(root);
    lastResult = { root, changes };

    output.appendLine(`Base: ${changes.base}`);
    for (const [file, lines] of changes.files) {
      output.appendLine(`  ${file}: ${lines.length} changed line(s)`);
    }
    output.show(true);
    decorateVisibleEditors();
  } catch (err) {
    output.appendLine(`git failed: ${err instanceof Error ? err.message : String(err)}`);
    output.show(true);
  }
}

function decorateVisibleEditors(): void {
  if (!lastResult) return;
  const { root, changes } = lastResult;
  for (const editor of vscode.window.visibleTextEditors) {
    const rel = path.relative(root, editor.document.uri.fsPath).split(path.sep).join('/');
    const lines = changes.files.get(rel) ?? [];
    editor.setDecorations(
      dot,
      lines.map((n) => new vscode.Range(n - 1, 0, n - 1, 0)),
    );
  }
}

export function deactivate(): void {}
