import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Level = 'error' | 'warn' | 'info';
export interface Entry {
	time: number;
	level: Level;
	area: string;
	message: string;
	/** Stack, error codes, raw cause. Everything needed to find out what happened. */
	detail?: string;
	/** Same error repeated within a minute is counted, not repeated. */
	count?: number;
}

const MAX_ENTRIES = 1000;
const MAX_FILE_BYTES = 1_000_000;

/** Hide anything that could unlock an account before it is stored, shown or exported. */
export function redact(text: string, secrets: string[] = []): string {
	let out = text;
	for (const s of secrets) if (s.length >= 4) out = out.split(s).join('[secret]');
	return out
		.replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[token]')
		.replace(/((?:access_token|refresh_token|steamLoginSecure|password|sessionid)["'=:\s]+)[^\s&"';,]+/gi, '$1[redacted]')
		.replace(/\b[A-Za-z0-9+/]{27}=/g, '[secret]')
		.replace(/\bR\d{5}\b/g, '[code]');
}

export function describeError(err: unknown): { message: string; detail?: string } {
	if (err instanceof Error) {
		const extra: string[] = [];
		const rec = err as unknown as Record<string, unknown>;
		for (const k of ['code', 'eresult', 'kind', 'status', 'errno', 'syscall']) if (rec[k] !== undefined) extra.push(`${k}=${String(rec[k])}`);
		const lines = [`${err.name}: ${err.message}`, ...(extra.length ? [extra.join(' ')] : []), ...(err.stack ? [err.stack.split('\n').slice(1, 8).join('\n')] : [])];
		const cause = (err as { cause?: unknown }).cause;
		if (cause !== undefined) lines.push(`Caused by: ${describeError(cause).message}`);
		return { message: err.message || err.name, detail: lines.join('\n') };
	}
	if (typeof err === 'string') return { message: err };
	try {
		return { message: 'Unknown error', detail: JSON.stringify(err) };
	} catch {
		return { message: 'Unknown error' };
	}
}

export class Logger {
	private entries: Entry[] = [];
	private file: string | undefined;
	private secrets: () => string[] = () => [];
	private onAdd: (() => void) | undefined;

	/** Keep the log in a file as well, and load what an earlier run left. */
	init(file: string, secrets: () => string[], onAdd?: () => void): void {
		this.file = file;
		this.secrets = secrets;
		this.onAdd = onAdd;
		try {
			mkdirSync(dirname(file), { recursive: true });
			if (existsSync(file)) {
				const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-300);
				for (const l of lines) {
					try {
						this.entries.push(JSON.parse(l) as Entry);
					} catch {
						/* skip a damaged line */
					}
				}
			}
		} catch {
			/* logging must never break the app */
		}
	}

	add(level: Level, area: string, message: string, err?: unknown): void {
		const s = this.secrets();
		const d = err === undefined ? undefined : describeError(err);
		const entry: Entry = {
			time: Math.floor(Date.now() / 1000),
			level,
			area,
			message: redact(message || d?.message || '', s).slice(0, 2000),
			...(d?.detail ? { detail: redact(d.detail, s).slice(0, 6000) } : {})
		};
		const last = this.entries[this.entries.length - 1];
		if (last && last.level === level && last.area === area && last.message === entry.message && entry.time - last.time < 60) {
			last.count = (last.count ?? 1) + 1;
			last.time = entry.time;
		} else {
			this.entries.push(entry);
			if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
			this.write(entry);
		}
		this.onAdd?.();
	}

	error = (area: string, message: string, err?: unknown): void => this.add('error', area, message, err);
	warn = (area: string, message: string, err?: unknown): void => this.add('warn', area, message, err);
	info = (area: string, message: string): void => this.add('info', area, message);

	list(): Entry[] {
		return [...this.entries].reverse();
	}

	/** How many errors are newer than `since` (Unix seconds); cheap enough to ask after every change. */
	errorsSince(since: number): number {
		let n = 0;
		for (let i = this.entries.length - 1; i >= 0; i--) {
			const e = this.entries[i]!;
			if (e.time <= since) break;
			if (e.level === 'error') n++;
		}
		return n;
	}

	clear(): void {
		this.entries = [];
		try {
			if (this.file) writeFileSync(this.file, '');
		} catch {
			/* ignore */
		}
	}

	/** Plain text for reading, copying or sending to someone. */
	text(): string {
		return [...this.entries]
			.map((e) => {
				const t = new Date(e.time * 1000).toISOString().replace('T', ' ').slice(0, 19);
				const head = `${t} ${e.level.toUpperCase().padEnd(5)} [${e.area}] ${e.message}${e.count && e.count > 1 ? ` (x${e.count})` : ''}`;
				return e.detail ? `${head}\n${e.detail.replace(/^/gm, '    ')}` : head;
			})
			.join('\n');
	}

	private write(entry: Entry): void {
		if (!this.file) return;
		try {
			if (existsSync(this.file) && statSync(this.file).size > MAX_FILE_BYTES) renameSync(this.file, `${this.file}.old`);
			appendFileSync(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 });
		} catch {
			/* ignore */
		}
	}
}

export const log = new Logger();
