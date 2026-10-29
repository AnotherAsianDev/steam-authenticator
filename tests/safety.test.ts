import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../src/main/atomic';
import { CredentialStore } from '../src/main/credentials';
import { SecretFile, Vault } from '../src/main/vault';

const dir = () => mkdtempSync(join(tmpdir(), 'safe-'));

describe('atomic writes', () => {
	it('keeps the previous copy as .bak and leaves no temp file', () => {
		const f = join(dir(), 'a.json');
		writeFileAtomic(f, 'one', { backup: true });
		writeFileAtomic(f, 'two', { backup: true });
		expect(readFileSync(f, 'utf8')).toBe('two');
		expect(readFileSync(`${f}.bak`, 'utf8')).toBe('one');
		expect(existsSync(`${f}.tmp`)).toBe(false);
	});
});

describe('damaged files', () => {
	it('never replaces a damaged credentials file with an empty one', () => {
		const f = join(dir(), 'credentials.json');
		writeFileSync(f, '{"7656119900000000": "pw", broken');
		const c = new CredentialStore(f, new Vault(join(dir(), 'v.json')));
		expect(c.has('7656119900000000')).toBe(true);
		expect(() => c.set('7656119900000001', 'x')).toThrow();
		expect(readFileSync(f, 'utf8')).toContain('broken');
	});
	it('falls back to the .bak copy', () => {
		const f = join(dir(), 'credentials.json');
		writeFileSync(f, 'garbage');
		writeFileSync(`${f}.bak`, JSON.stringify({ '7656119900000000': 'pw' }));
		const c = new CredentialStore(f, new Vault(join(dir(), 'v.json')));
		expect(c.get('7656119900000000')).toBe('pw');
	});
	it('opens the vault from its .bak when vault.json is damaged', () => {
		const d = dir();
		const f = join(d, 'vault.json');
		const v = new Vault(f);
		v.setUp('correct horse');
		writeFileSync(`${f}.bak`, readFileSync(f, 'utf8'));
		writeFileSync(f, '{oops');
		expect(new Vault(f).isSetUp()).toBe(true);
	});
	it('SecretFile.readJson reports damage', () => {
		const f = join(dir(), 's.json');
		writeFileSync(f, '[1,');
		const s = new SecretFile(f, 'x');
		expect(s.readJson()).toBeUndefined();
		expect(s.damaged).toBe(true);
	});
});
