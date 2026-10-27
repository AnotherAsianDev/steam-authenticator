import { existsSync, watch, type FSWatcher } from 'node:fs';

/**
 * Calls `onChange(dir)` once things settle after files appear or change in any
 * watched folder. The pause lets a copy finish before anything reads the file.
 */
export class FolderWatcher {
	private watchers = new Map<string, FSWatcher>();
	private timers = new Map<string, NodeJS.Timeout>();

	constructor(
		private readonly onChange: (dir: string) => void,
		private readonly debounceMs = 1000
	) {}

	/** Watch exactly these folders; anything no longer listed is dropped. */
	setFolders(dirs: string[]): void {
		const wanted = new Set(dirs);
		for (const [dir, w] of this.watchers) {
			if (!wanted.has(dir)) {
				w.close();
				this.watchers.delete(dir);
			}
		}
		for (const dir of wanted) {
			if (this.watchers.has(dir) || !existsSync(dir)) continue;
			try {
				const w = watch(dir, { persistent: false }, () => this.schedule(dir));
				// A folder that disappears (drive unplugged) must not crash the app.
				w.on('error', () => {
					w.close();
					this.watchers.delete(dir);
				});
				this.watchers.set(dir, w);
			} catch {
				/* not watchable (permissions, network drive): the startup scan still covers it */
			}
		}
	}

	private schedule(dir: string): void {
		clearTimeout(this.timers.get(dir));
		const t = setTimeout(() => {
			this.timers.delete(dir);
			this.onChange(dir);
		}, this.debounceMs);
		t.unref();
		this.timers.set(dir, t);
	}

	close(): void {
		for (const w of this.watchers.values()) w.close();
		for (const t of this.timers.values()) clearTimeout(t);
		this.watchers.clear();
		this.timers.clear();
	}
}
