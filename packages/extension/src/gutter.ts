// Gutter and overview-ruler marks: unseen (amber dot), seen (green check), not trackable (grey ring).
import * as vscode from 'vscode';
import { toRepoRelative } from '@change-spotlight/core';
import { decorationRanges, type FileMarks, type MarkStyle } from './decorations';
import type { SeenState } from './seenController';

export class Gutter implements vscode.Disposable {
  private readonly types: Record<MarkStyle, vscode.TextEditorDecorationType>;
  private marks = new Map<string, FileMarks>();
  private root: string | undefined;

  constructor(extensionUri: vscode.Uri) {
    const icon = (name: string) => ({
      light: { gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', `gutter-${name}-light.svg`), gutterIconSize: 'contain' },
      dark: { gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', `gutter-${name}-dark.svg`), gutterIconSize: 'contain' },
    });
    this.types = {
      unseen: vscode.window.createTextEditorDecorationType({
        ...icon('unseen'),
        overviewRulerColor: new vscode.ThemeColor('changeSpotlight.unseenRuler'),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      }),
      seen: vscode.window.createTextEditorDecorationType({
        ...icon('seen'),
        overviewRulerColor: new vscode.ThemeColor('changeSpotlight.seenRuler'),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      }),
      untrackable: vscode.window.createTextEditorDecorationType(icon('untrackable')),
    };
  }

  update(state: SeenState | undefined): void {
    this.root = state?.root;
    this.marks = state ? decorationRanges(state.hunks) : new Map();
    this.apply();
  }

  apply(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const rel = this.root && editor.document.uri.scheme === 'file' ? toRepoRelative(editor.document.uri.fsPath, this.root) : null;
      const marks = rel ? this.marks.get(rel) : undefined;
      for (const style of ['unseen', 'seen', 'untrackable'] as const) {
        editor.setDecorations(
          this.types[style],
          (marks?.[style] ?? []).map((r) => new vscode.Range(r.start - 1, 0, r.end - 1, 0)),
        );
      }
    }
  }

  dispose(): void {
    for (const type of Object.values(this.types)) type.dispose();
  }
}
