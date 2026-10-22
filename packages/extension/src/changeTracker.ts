import * as vscode from 'vscode';
import { computeChanges, type ChangeResult, type RepoInfo } from './git';

const DEBOUNCE_MS = 300;

/**
 * Keeps an up-to-date ChangeResult for one repository. Recomputes (debounced, never two runs
 * at once) when files are saved/created/deleted/renamed, when git's HEAD, index or HEAD reflog
 * change (commit, checkout, reset, rebase, staging), and when the base setting changes.
 */
export class ChangeTracker implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ChangeResult>();
  /** Fires after every completed run. */
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [this.emitter];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private rerun = false;
  private lastResult: ChangeResult | undefined;

  constructor(private readonly repo: RepoInfo) {
    const trigger = () => this.schedule();

    // Our own non-recursive watchers on git's files. Non-recursive watchers are not affected by
    // files.watcherExclude, and gitDir is per worktree (where .git may be a file).
    for (const [dir, glob] of [
      [repo.gitDir, '{HEAD,index}'],
      [`${repo.gitDir}/logs`, 'HEAD'],
    ] as const) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), glob));
      watcher.onDidChange(trigger);
      watcher.onDidCreate(trigger);
      watcher.onDidDelete(trigger);
      this.disposables.push(watcher);
    }

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(trigger),
      vscode.workspace.onDidCreateFiles(trigger),
      vscode.workspace.onDidDeleteFiles(trigger),
      vscode.workspace.onDidRenameFiles(trigger),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('changeSpotlight.baseBranch') || e.affectsConfiguration('changeSpotlight.exclude')) trigger();
      }),
    );
  }

  get result(): ChangeResult | undefined {
    return this.lastResult;
  }

  /** True while a recompute is scheduled or running: line numbers may be about to change. */
  get busy(): boolean {
    return this.timer !== undefined || this.running;
  }

  /** Debounced recompute. */
  schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, DEBOUNCE_MS);
  }

  /** Recompute now (or right after the current run) and resolve with the fresh result. */
  async refresh(): Promise<ChangeResult> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.run();
    // If a run was already active, run() only set the rerun flag; wait for that follow-up run.
    while (this.running) await new Promise((r) => setTimeout(r, 20));
    return this.lastResult!;
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        const configured = vscode.workspace.getConfiguration('changeSpotlight').get<string>('baseBranch', '');
        this.lastResult = await computeChanges(this.repo.root, configured);
        this.emitter.fire(this.lastResult);
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}
