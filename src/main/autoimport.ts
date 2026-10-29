import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { MaFileError, parseMaFile, steamIdFromManifest, type ParsedMaFile } from './mafile';
import type { MaFileStore } from './store';

const SKIP_DIRS = new Set(['node_modules', '.git', 'appdata', 'windows', '$recycle.bin']);

/** Folders named "maFiles" (SDA's) below the given roots, a few levels deep. */
export function findMaFileFolders(roots: string[], maxDepth = 3, maxDirs = 4000): string[] {
	const found: string[] = [];
	let visited = 0;
	const walk = (dir: string, depth: number): void => {
		if (visited++ > maxDirs) return;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory() || SKIP_DIRS.has(e.name.toLowerCase())) continue;
			const path = join(dir, e.name);
			if (e.name.toLowerCase() === 'mafiles') {
				found.push(path);
				continue; // no need to look inside
			}
			if (depth < maxDepth) walk(path, depth + 1);
		}
	};
	for (const r of roots) if (existsSync(r)) walk(r, 1);
	return found;
}

/** Reads one maFile. When the file itself does not say which account it is, the manifest.json next to it (SDA's list of its files) can. */
export function readMaFile(path: string): ParsedMaFile {
	if (statSync(path).size > 1_000_000) throw new MaFileError('File is too large');
	const text = readFileSync(path, 'utf8');
	try {
		return parseMaFile(text);
	} catch (err) {
		if (!(err instanceof MaFileError) || !/No SteamID/.test(err.message)) throw err;
		let hint: string | undefined;
		try {
			hint = steamIdFromManifest(readFileSync(join(dirname(path), 'manifest.json'), 'utf8'), basename(path));
		} catch {
			/* no manifest */
		}
		if (!hint) throw err;
		return parseMaFile(text, hint);
	}
}

export interface FolderImport {
	added: string[];
	skipped: number;
	failed: { file: string; message: string }[];
}

/**
 * Copy new accounts from a folder. Accounts already stored are left alone, so
 * an automatic pass can never overwrite newer data with an older file. `skip`
 * holds SteamIDs that must not come back on their own (the trash).
 */
export function importFolder(dir: string, store: MaFileStore, skip: ReadonlySet<string> = new Set()): FolderImport {
	const result: FolderImport = { added: [], skipped: 0, failed: [] };
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => /\.mafile$/i.test(f)).slice(0, 200);
	} catch {
		return result;
	}
	for (const file of files) {
		try {
			const m = readMaFile(join(dir, file));
			// Accounts the user removed stay removed, even though the original file is still there.
			if (store.has(m.steamId) || skip.has(m.steamId)) {
				result.skipped++;
				continue;
			}
			store.save(m.steamId, m.raw);
			result.added.push(m.accountName);
		} catch (err) {
			result.failed.push({ file, message: err instanceof MaFileError ? err.message : 'Could not read file' });
		}
	}
	return result;
}

const CANONICAL = /^\d{17}\.maFile$/;

export interface StoreScan {
	added: string[];
	/** Files already represented by a stored account; left exactly as they are. */
	duplicates: string[];
	failed: { file: string; message: string }[];
}

/**
 * Tidy the app's own folder after the user drops maFiles into it.
 *
 * A dropped file can have any name. Valid ones are renamed to `<steamid>.maFile`
 * so the app finds them; this is the app's own folder, so renaming is fine. A
 * file for an account that already exists is left alone, never overwritten.
 */
export function normalizeStoreFolder(store: MaFileStore): StoreScan {
	const result: StoreScan = { added: [], duplicates: [], failed: [] };
	let files: string[];
	try {
		files = readdirSync(store.dir);
	} catch {
		return result;
	}
	for (const file of files) {
		if (CANONICAL.test(file)) continue;
		if (!/\.(mafile|json)$/i.test(file) || file.toLowerCase() === 'manifest.json') continue;
		const path = join(store.dir, file);
		try {
			const m = readMaFile(path);
			if (store.has(m.steamId)) {
				result.duplicates.push(file);
				continue;
			}
			store.save(m.steamId, m.raw);
			rmSync(path, { force: true });
			result.added.push(m.accountName);
		} catch (err) {
			result.failed.push({ file, message: err instanceof MaFileError ? err.message : 'Could not read file' });
		}
	}
	return result;
}
