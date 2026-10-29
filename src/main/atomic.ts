import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
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
	renameSync(tmp, file);
}

/** What to tell the person when a file could not be written. */
export function describeWriteError(err: unknown): string | undefined {
	const code = (err as { code?: unknown } | null)?.code;
	if (code === 'ENOSPC') return 'The disk is full, so nothing was saved';
	if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'The folder is read-only or not allowed to be changed, so nothing was saved';
	if (code === 'EBUSY' || code === 'EMFILE') return 'Another program is using the file, so nothing was saved. Try again';
	return undefined;
}
