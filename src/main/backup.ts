import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { UserError } from './errors';

/** What one account contributes to a backup. */
export interface BackupAccount {
	steamId: string;
	maFile: string;
	password?: string;
	meta?: { pinned: boolean; note: string; tags: string[]; skipBulk: boolean };
}
export interface BackupContent {
	version: 1;
	createdAt: string;
	accounts: BackupAccount[];
}

const MAGIC = Buffer.from('SABK1');
export const MIN_PASSWORD = 8;

const key = (password: string, salt: Buffer): Buffer => scryptSync(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

/** One file: magic, salt, iv, auth tag, then the compressed content sealed with AES-256-GCM. */
export function sealBackup(content: BackupContent, password: string): Buffer {
	if (password.length < MIN_PASSWORD) throw new UserError(`Choose a password of at least ${MIN_PASSWORD} characters. The file holds every secret`);
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(password, salt), iv);
	const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(content), 'utf8'))), cipher.final()]);
	return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function openBackup(file: Buffer, password: string): BackupContent {
	if (file.length < MAGIC.length + 44 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new UserError('This is not a backup made by this program');
	let o = MAGIC.length;
	const salt = file.subarray(o, (o += 16));
	const iv = file.subarray(o, (o += 12));
	const tag = file.subarray(o, (o += 16));
	let json: unknown;
	try {
		const decipher = createDecipheriv('aes-256-gcm', key(password, salt), iv);
		decipher.setAuthTag(tag);
		json = JSON.parse(gunzipSync(Buffer.concat([decipher.update(file.subarray(o)), decipher.final()])).toString('utf8'));
	} catch {
		throw new UserError('Wrong password, or the file is damaged');
	}
	const c = json as Partial<BackupContent> | null;
	if (!c || c.version !== 1 || !Array.isArray(c.accounts)) throw new UserError('This backup is from a newer version of the program');
	const accounts = c.accounts.filter(
		(a): a is BackupAccount => typeof a === 'object' && a !== null && /^\d{17}$/.test(String((a as BackupAccount).steamId)) && typeof (a as BackupAccount).maFile === 'string'
	);
	return { version: 1, createdAt: String(c.createdAt ?? ''), accounts };
}
