import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface Layout {
	/** Settings, saved passwords, tokens, caches. */
	data: string;
	/** The maFiles, next to the program like SDA keeps them. */
	maFiles: string;
	/** Chromium's own scratch files. */
	chromium: string;
	portable: boolean;
}

/**
 * Packaged: everything lives next to the program (maFiles and data folders),
 * so the whole thing can be copied or backed up as one folder. Not packaged, or
 * when that folder cannot be written (for example Program Files): the normal
 * per-user app data folder.
 */
export function resolveLayout(isPackaged: boolean, execPath: string, legacy: string): Layout {
	const fallback: Layout = { data: legacy, maFiles: join(legacy, 'maFiles'), chromium: legacy, portable: false };
	if (!isPackaged) return fallback;
	const exeDir = dirname(execPath);
	// The real program sits in an app subfolder, behind a small launcher.
	const root = basename(exeDir).toLowerCase() === 'app' ? dirname(exeDir) : exeDir;
	const data = join(root, 'data');
	try {
		mkdirSync(data, { recursive: true });
		const probe = join(data, '.write-test');
		writeFileSync(probe, '');
		rmSync(probe);
	} catch {
		return fallback;
	}
	return { data, maFiles: join(root, 'maFiles'), chromium: join(data, 'browser'), portable: true };
}

const FILES = ['settings.json', 'credentials.json', 'sessions.json', 'cache.json'];
const DIRS = ['avatars', 'pending'];

/** First start of the portable layout: bring over what the old per-user folder had. Never deletes anything. */
export function migrateLegacy(legacy: string, layout: Layout): string[] {
	if (!layout.portable || legacy === layout.data || !existsSync(legacy)) return [];
	const hasNew = existsSync(join(layout.data, 'settings.json')) || (existsSync(layout.maFiles) && readdirSync(layout.maFiles).length > 0);
	if (hasNew) return [];
	const moved: string[] = [];
	const oldMa = join(legacy, 'maFiles');
	if (existsSync(oldMa)) {
		cpSync(oldMa, layout.maFiles, { recursive: true });
		moved.push('maFiles');
	}
	for (const f of FILES) {
		if (existsSync(join(legacy, f))) {
			cpSync(join(legacy, f), join(layout.data, f));
			moved.push(f);
		}
	}
	for (const d of DIRS) {
		if (existsSync(join(legacy, d))) {
			cpSync(join(legacy, d), join(layout.data, d), { recursive: true });
			moved.push(d);
		}
	}
	return moved;
}
