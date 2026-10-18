// VS Code glue for the "Changes" tree: turns the plain nodes from tree.ts into TreeItems.
import * as vscode from 'vscode';
import { buildTree, type TreeNode } from './tree';
import type { SeenState } from './seenController';

export class ChangesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private roots: TreeNode[] = [];

  update(state: SeenState | undefined): void {
    this.roots = state ? buildTree(state) : [];
    this.emitter.fire(undefined);
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? (node.children ?? []) : this.roots;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const state =
      node.kind === 'hunk'
        ? vscode.TreeItemCollapsibleState.None
        : node.collapsed
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded;
    const item = new vscode.TreeItem(node.label, state);
    item.id = node.id;
    if (node.description) item.description = node.description;
    if (node.tooltip) item.tooltip = node.tooltip;
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.contextValue) item.contextValue = node.contextValue;
    if (node.open) item.command = { command: 'changeSpotlight.openHunk', title: 'Open Change', arguments: [node] };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
