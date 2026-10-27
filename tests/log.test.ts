import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Logger, describeError, log, redact } from '../src/main/log';

describe('log', () => {
	it('hides tokens, secrets, passwords and revocation codes', () => {
		const jwt = 'eyJhbGciOiJub25lIn0.eyJhdWQiOlsibW9iaWxlIl19.c2ln';
		const text = `GET ?access_token=${jwt}&x=1 password=hunter22 shared=MDEyMzQ1Njc4OWFiY2RlZjAxMjM= code R12345 own=secretvalue`;
		const out = redact(text, ['secretvalue']);
		expect(out).not.toMatch(/eyJ|hunter22|MDEyMzQ1|R12345|secretvalue/);
		expect(out).toContain('[redacted]');
	});

	it('keeps the full detail of an error, minus secrets', () => {
		const dir = mkdtempSync(join(tmpdir(), 'log-'));
		const file = join(dir, 'log.jsonl');
		log.clear();
		log.init(file, () => ['pw-secret-1']);
		const err = Object.assign(new Error('connect ECONNRESET pw-secret-1'), { code: 'ECONNRESET' });
		log.error('test', 'It failed', err);
		const [e] = log.list();
		expect(e).toMatchObject({ level: 'error', area: 'test', message: 'It failed' });
		expect(e!.detail).toContain('ECONNRESET');
		expect(e!.detail).toContain('code=ECONNRESET');
		expect(e!.detail).not.toContain('pw-secret-1');
		expect(readFileSync(file, 'utf8')).not.toContain('pw-secret-1');
		expect(log.text()).toMatch(/ERROR \[test\] It failed/);
	});

	it('counts repeats instead of filling the log', () => {
		log.clear();
		for (let i = 0; i < 5; i++) log.warn('net', 'Could not reach Steam');
		expect(log.list()).toHaveLength(1);
		expect(log.list()[0]!.count).toBe(5);
	});

	it('describes odd values without throwing', () => {
		expect(describeError('plain').message).toBe('plain');
		expect(describeError({ a: 1 }).detail).toBe('{"a":1}');
		const cyc: Record<string, unknown> = {};
		cyc['self'] = cyc;
		expect(describeError(cyc).message).toBe('Unknown error');
	});

	it('reloads what an earlier run wrote', () => {
		const dir = mkdtempSync(join(tmpdir(), 'log-'));
		const file = join(dir, 'log.jsonl');
		const first = new Logger();
		first.init(file, () => []);
		first.error('a', 'first run problem');
		const second = new Logger();
		second.init(file, () => []);
		expect(second.list().map((x) => x.message)).toContain('first run problem');
	});

	it('counts only newer errors', () => {
		const l = new Logger();
		l.error('a', 'one');
		l.warn('a', 'two');
		expect(l.errorsSince(0)).toBe(1);
		expect(l.errorsSince(Math.floor(Date.now() / 1000) + 5)).toBe(0);
	});
});
