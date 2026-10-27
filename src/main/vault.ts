import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UserError } from './errors';

/**
 * Optional master password for the files that hold sign-in secrets
 * (credentials.json, sessions.json, and a trashed account's password).
 * The maFiles are never touched.
 *
 * One random 256-bit data key encrypts those files (AES-256-GCM). The data key
 * itself is stored wrapped by a key derived from the master password (scrypt),
 * so changing the password only re-wraps it, and a PIN on one PC can wrap the
 * same key without the master password having to be typed again.
 */

type Kdf = { N: number; r: number; p: number };
const PASSWORD_KDF: Kdf = { N: 32768, r: 8, p: 1 };
const PIN_KDF: Kdf = { N: 131072, r: 8, p: 1 };
const MAX_PIN_FAILS = 5;

const derive = (secret: string, salt: Buffer, k: Kdf): Buffer =>
	scryptSync(secret.normalize('NFKC'), salt, 32, { N: k.N, r: k.r, p: k.p, maxmem: 512 * 1024 * 1024 });

interface Sealed {
	iv: string;
	tag: string;
	data: string;
}

function seal(key: Buffer, plain: Buffer, aad: string): Sealed {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key, iv);
	c.setAAD(Buffer.from(aad));
	const data = Buffer.concat([c.update(plain), c.final()]);
	return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** Throws when the key is wrong or the data was changed. */
function open(key: Buffer, s: Sealed, aad: string): Buffer {
	const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
	d.setAAD(Buffer.from(aad));
	d.setAuthTag(Buffer.from(s.tag, 'base64'));
	return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]);
}

const isSealed = (o: unknown): o is Sealed =>
	typeof o === 'object' && o !== null && ['iv', 'tag', 'data'].every((k) => typeof (o as Record<string, unknown>)[k] === 'string');

function writeAtomic(file: string, text: string): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, text, { mode: 0o600 });
	renameSync(tmp, file);
}

export function checkPassword(password: string): void {
	if (password.length < 8) throw new UserError('Use at least 8 characters. A few words in a row are easier to remember than symbols');
	if (password.length > 256) throw new UserError('That password is too long');
}
export function checkPin(pin: string): void {
	if (!/^\d{4,12}$/.test(pin)) throw new UserError('A PIN is 4 to 12 digits. 6 or more is better');
}

interface Meta extends Sealed {
	v: 1;
	id: string;
	kdf: Kdf;
	salt: string;
}

export class Vault {
	private meta: Meta | undefined;
	private dek: Buffer | undefined;

	constructor(readonly file: string) {
		try {
			if (existsSync(file)) {
				const m = JSON.parse(readFileSync(file, 'utf8')) as Partial<Meta>;
				if (m.v === 1 && typeof m.id === 'string' && typeof m.salt === 'string' && m.kdf && isSealed(m)) this.meta = m as Meta;
			}
		} catch {
			/* an unreadable vault file is treated as absent; the encrypted files then stay locked and untouched */
		}
	}

	/** Encryption has been turned on. */
	isSetUp(): boolean {
		return !!this.meta;
	}
	/** Nothing to unlock, or already unlocked. */
	isUnlocked(): boolean {
		return !this.meta || !!this.dek;
	}
	get id(): string | undefined {
		return this.meta?.id;
	}

	private unwrap(password: string): Buffer {
		if (!this.meta) throw new UserError('Encryption is not turned on');
		try {
			return open(derive(password, Buffer.from(this.meta.salt, 'base64'), this.meta.kdf), this.meta, 'vault');
		} catch {
			throw new UserError('Wrong master password');
		}
	}
	private wrap(dek: Buffer, password: string, id: string): Meta {
		const salt = randomBytes(16);
		return { v: 1, id, kdf: PASSWORD_KDF, salt: salt.toString('base64'), ...seal(derive(password, salt, PASSWORD_KDF), dek, 'vault') };
	}

	setUp(password: string): void {
		if (this.meta) throw new UserError('A master password is already set');
		checkPassword(password);
		const dek = randomBytes(32);
		const meta = this.wrap(dek, password, randomUUID());
		writeAtomic(this.file, JSON.stringify(meta));
		this.meta = meta;
		this.dek = dek;
	}

	unlock(password: string): void {
		this.dek = this.unwrap(password);
	}

	/** With the key a PIN released. */
	unlockWithKey(dek: Buffer): void {
		if (!this.meta) throw new UserError('Encryption is not turned on');
		this.dek = Buffer.from(dek);
	}

	lock(): void {
		this.dek?.fill(0);
		this.dek = undefined;
	}

	changePassword(oldPassword: string, next: string): void {
		const dek = this.unwrap(oldPassword);
		checkPassword(next);
		const meta = this.wrap(dek, next, this.meta!.id);
		writeAtomic(this.file, JSON.stringify(meta));
		this.meta = meta;
		this.dek = dek;
	}

	/** Throws 'Wrong master password' unless this is it. */
	verify(password: string): void {
		this.unwrap(password);
	}

	/** Turn encryption off. The caller writes the files back in plain text first. */
	remove(password: string): void {
		this.unwrap(password);
		rmSync(this.file, { force: true });
		this.lock();
		this.meta = undefined;
	}

	exportKey(): Buffer {
		if (!this.dek) throw new UserError('Unlock first');
		return Buffer.from(this.dek);
	}

	seal(label: string, text: string): string {
		if (!this.dek) throw new UserError('Locked. Enter the master password first');
		return JSON.stringify({ enc: 1, ...seal(this.dek, Buffer.from(text, 'utf8'), label) });
	}

	/** Text of a sealed file; throws UserError when locked and Error when it cannot be opened. */
	openEnvelope(label: string, env: Sealed): string {
		if (!this.dek) throw new UserError('Locked. Enter the master password first');
		return open(this.dek, env, label).toString('utf8');
	}
}

/** A sealed file's content, or undefined for ordinary text. */
export function parseEnvelope(text: string): Sealed | undefined {
	if (!text.startsWith('{')) return undefined;
	try {
		const o = JSON.parse(text) as Record<string, unknown>;
		return o['enc'] === 1 && isSealed(o) ? { iv: o['iv'] as string, tag: o['tag'] as string, data: o['data'] as string } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * One JSON file that is encrypted when the vault is on, plain when it is not.
 * Plain files are still read after encryption was turned on (and then written
 * back sealed), so turning it on or off can never lose the data in between.
 *
 * While the content cannot be read (locked, or sealed with another key) the
 * file is `locked` and every write is refused, so a locked file can never be
 * overwritten with an empty one.
 */
export class SecretFile {
	locked = false;
	constructor(
		private readonly file: string,
		private readonly label: string,
		private readonly vault?: Vault
	) {}

	read(): string | undefined {
		this.locked = false;
		if (!existsSync(this.file)) return undefined;
		const text = readFileSync(this.file, 'utf8');
		const env = parseEnvelope(text);
		if (!env) return text;
		try {
			if (!this.vault) throw new Error('sealed file without a vault');
			return this.vault.openEnvelope(this.label, env);
		} catch {
			this.locked = true;
			return undefined;
		}
	}

	write(text: string, forcePlain = false): void {
		if (this.locked) throw new UserError('Saved passwords are locked. Enter the master password first');
		const sealed = !forcePlain && !!this.vault?.isSetUp();
		writeAtomic(this.file, sealed ? this.vault!.seal(this.label, text) : text);
	}
}

/**
 * A PIN for this PC only.
 *
 * The data key is wrapped by a key derived from the PIN and kept in a file
 * outside the portable folder, so a copy of the folder (cloud, backup, another
 * PC) has no PIN at all and needs the master password. After too many wrong
 * PINs the file is deleted. This is a convenience for a trusted PC, not a
 * strong barrier: someone who can read this PC's user files can try PINs
 * offline, which is why a long PIN and a disk encryption such as BitLocker help.
 */
export class DevicePin {
	constructor(
		private readonly dir: string,
		private readonly vaultId: () => string | undefined,
		private readonly kdf: Kdf = PIN_KDF
	) {}

	private path(): string | undefined {
		const id = this.vaultId();
		return id ? join(this.dir, `pin-${id}.json`) : undefined;
	}
	private read(): (Sealed & { v: 1; salt: string; fails: number; kdf: Kdf }) | undefined {
		const p = this.path();
		if (!p || !existsSync(p)) return undefined;
		try {
			const o = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
			if (o['v'] === 1 && typeof o['salt'] === 'string' && typeof o['fails'] === 'number' && isSealed(o)) return o as never;
		} catch {
			/* damaged: treated as no PIN */
		}
		return undefined;
	}

	isSet(): boolean {
		return !!this.read();
	}
	attemptsLeft(): number {
		const r = this.read();
		return r ? Math.max(0, MAX_PIN_FAILS - r.fails) : 0;
	}

	set(pin: string, dek: Buffer): void {
		checkPin(pin);
		const p = this.path();
		if (!p) throw new UserError('Turn on the master password first');
		const salt = randomBytes(16);
		writeAtomic(p, JSON.stringify({ v: 1, kdf: this.kdf, salt: salt.toString('base64'), fails: 0, ...seal(derive(pin, salt, this.kdf), dek, 'pin') }));
	}

	/** The data key, or a UserError saying how many tries are left. */
	unlock(pin: string): Buffer {
		const r = this.read();
		const p = this.path();
		if (!r || !p) throw new UserError('No PIN is set on this PC');
		try {
			const dek = open(derive(pin, Buffer.from(r.salt, 'base64'), r.kdf), r, 'pin');
			if (r.fails) writeAtomic(p, JSON.stringify({ ...r, fails: 0 }));
			return dek;
		} catch {
			const fails = r.fails + 1;
			if (fails >= MAX_PIN_FAILS) {
				rmSync(p, { force: true });
				throw new UserError('Too many wrong PINs. The PIN was removed, use the master password');
			}
			writeAtomic(p, JSON.stringify({ ...r, fails }));
			const left = MAX_PIN_FAILS - fails;
			throw new UserError(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left`);
		}
	}

	remove(): void {
		const p = this.path();
		if (p) rmSync(p, { force: true });
	}
}
