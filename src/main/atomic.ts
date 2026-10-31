import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Writes a file so that a crash, a power cut or a full disk can never leave a half-written one:
 * the new content goes to `<file>.tmp`, is flushed to disk, and only then replaces the old file
 * in one step. With `backup` the file it replaces is kept once as `<file>.bak`.
 */
export function writeFileAtomic(file: string, data: string | Buffer, opts: { mode?: number; backup?: boolean } = {}): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	const fd = openSync(tmp, 'w', opts.mode ?? 0o600);
	try {
		writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	if (opts.backup && existsSync(file)) {
		try {
			copyFileSync(file, `${file}.bak`);
		} catch {
			/* a failed backup must not stop the save */
		}
	}
	replace(tmp, file, data, opts.mode);
}

const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Moves the finished temporary file over the real one. A folder that a sync program (Proton Drive, OneDrive, an antivirus) is watching can refuse the
 * rename for a moment (EPERM, EBUSY, EACCES), so it is tried again a few times. If it is still refused, the content is written straight into the file.
 */
function replace(tmp: string, file: string, data: string | Buffer, mode?: number): void {
	const busy = (err: unknown): boolean => ['EPERM', 'EBUSY', 'EACCES'].includes((err as { code?: string } | null)?.code ?? '');
	for (const wait of [0, 25, 60, 120, 250, 500, 1000]) {
		sleep(wait);
		try {
			renameSync(tmp, file);
			return;
		} catch (err) {
			if (!busy(err)) throw err;
		}
	}
	writeFileSync(file, data, { mode: mode ?? 0o600 });
	try {
		unlinkSync(tmp);
	} catch {
		/* the leftover temporary file is harmless */
	}
}

/** What to tell the person when a file could not be written. */
export function describeWriteError(err: unknown): string | undefined {
	const code = (err as { code?: unknown } | null)?.code;
	if (code === 'ENOSPC') return 'The disk is full, so nothing was saved';
	if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'The folder is read-only or not allowed to be changed, so nothing was saved';
	if (code === 'EBUSY' || code === 'EMFILE') return 'Another program is using the file, so nothing was saved. Try again';
	return undefined;
}
