import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CredentialStore } from '../src/main/credentials';
import { TokenStore } from '../src/main/sessions';
import { Trash } from '../src/main/trash';
import { DevicePin, Vault } from '../src/main/vault';

const ID = '76561198000000001';
const SEC = Buffer.from('0123456789abcdef0123').toString('base64');
const maFile = `{"shared_secret":"${SEC}","identity_secret":"${SEC}","account_name":"olam","Session":{"SteamID":${ID}}}`;
const PW = 'correct horse battery';

function folder() {
	const dir = mkdtempSync(join(tmpdir(), 'vault-'));
	const open = () => {
		const vault = new Vault(join(dir, 'vault.json'));
		return { vault, credentials: new CredentialStore(join(dir, 'credentials.json'), vault), tokens: new TokenStore(join(dir, 'sessions.json'), vault), trash: new Trash(join(dir, 'trash'), vault) };
	};
	return { dir, open };
}
const text = (f: string) => readFileSync(f, 'utf8');

describe('master password', () => {
	it('encrypts the files, and a fresh start needs the password to read them', () => {
		const { dir, open } = folder();
		const a = open();
		a.credentials.set(ID, 'hunter2-secret');
		a.tokens.set(ID, 'refresh-token-value');
		expect(text(join(dir, 'credentials.json'))).toContain('hunter2-secret');

		a.vault.setUp(PW);
		a.credentials.rewrite();
		a.tokens.rewrite();
		for (const f of ['credentials.json', 'sessions.json']) expect(text(join(dir, f))).not.toMatch(/hunter2|refresh-token|76561198/);
		expect(a.credentials.get(ID)).toBe('hunter2-secret');

		const b = open();
		expect(b.vault.isUnlocked()).toBe(false);
		expect(b.credentials.get(ID)).toBeUndefined();
		expect(b.credentials.locked).toBe(true);
		b.vault.unlock(PW);
		b.credentials.reload();
		b.tokens.reload();
		expect(b.credentials.get(ID)).toBe('hunter2-secret');
		expect(b.tokens.get(ID)).toBe('refresh-token-value');
	});

	it('refuses a wrong password and leaves everything locked', () => {
		const { open } = folder();
		const a = open();
		a.vault.setUp(PW);
		const b = open();
		expect(() => b.vault.unlock('not the password')).toThrow('Wrong master password');
		expect(b.vault.isUnlocked()).toBe(false);
	});

	it('insists on a reasonable password', () => {
		expect(() => folder().open().vault.setUp('short')).toThrow('at least 8');
	});

	it('a locked store pretends nothing is missing and refuses every change', () => {
		const { dir, open } = folder();
		const a = open();
		a.credentials.set(ID, 'hunter2-secret');
		a.vault.setUp(PW);
		a.credentials.rewrite();
		const before = text(join(dir, 'credentials.json'));

		const b = open();
		expect(b.credentials.has(ID)).toBe(true);
		expect(b.credentials.has('76561198000000002')).toBe(true);
		expect(() => b.credentials.set(ID, 'other')).toThrow('locked');
		b.credentials.delete(ID); // nothing is known while locked, and nothing is written
		expect(() => b.tokens.set(ID, 'x')).toThrow();
		expect(text(join(dir, 'credentials.json'))).toBe(before);
	});

	it('still reads a plain file after it was turned on, and writes it back sealed', () => {
		const { dir, open } = folder();
		const a = open();
		a.credentials.set(ID, 'hunter2-secret');
		a.vault.setUp(PW);
		const b = open();
		b.vault.unlock(PW);
		b.credentials.reload();
		expect(b.credentials.get(ID)).toBe('hunter2-secret');
		b.credentials.set('76561198000000002', 'another');
		expect(text(join(dir, 'credentials.json'))).not.toContain('hunter2');
	});

	it('changing the password keeps the data and the old password stops working', () => {
		const { open } = folder();
		const a = open();
		a.vault.setUp(PW);
		a.credentials.set(ID, 'hunter2-secret');
		a.vault.changePassword(PW, 'a different phrase');
		const b = open();
		expect(() => b.vault.unlock(PW)).toThrow();
		b.vault.unlock('a different phrase');
		b.credentials.reload();
		expect(b.credentials.get(ID)).toBe('hunter2-secret');
	});

	it('turning it off writes plain files again', () => {
		const { dir, open } = folder();
		const a = open();
		a.vault.setUp(PW);
		a.credentials.set(ID, 'hunter2-secret');
		a.credentials.rewrite(true);
		a.tokens.rewrite(true);
		a.vault.remove(PW);
		expect(existsSync(join(dir, 'vault.json'))).toBe(false);
		expect(text(join(dir, 'credentials.json'))).toContain('hunter2-secret');
		expect(open().credentials.get(ID)).toBe('hunter2-secret');
	});

	it('a tampered or swapped file is locked, never read wrongly', () => {
		const { dir, open } = folder();
		const a = open();
		a.vault.setUp(PW);
		a.credentials.set(ID, 'hunter2-secret');
		a.tokens.set(ID, 'tok');
		// Same key, but the sessions file may not pass for the credentials file.
		copyFileSync(join(dir, 'sessions.json'), join(dir, 'credentials.json'));
		const b = open();
		b.vault.unlock(PW);
		b.credentials.reload();
		expect(b.credentials.locked).toBe(true);
		expect(b.credentials.get(ID)).toBeUndefined();
		expect(() => b.credentials.set(ID, 'x')).toThrow();

		const sealed = JSON.parse(text(join(dir, 'sessions.json')));
		sealed.data = Buffer.from('garbage').toString('base64');
		writeFileSync(join(dir, 'sessions.json'), JSON.stringify(sealed));
		const c = open();
		c.vault.unlock(PW);
		c.tokens.reload();
		expect(c.tokens.locked).toBe(true);
	});

	it('a lost vault file leaves the sealed files locked and untouched', () => {
		const { dir, open } = folder();
		const a = open();
		a.vault.setUp(PW);
		a.credentials.set(ID, 'hunter2-secret');
		const sealed = text(join(dir, 'credentials.json'));
		writeFileSync(join(dir, 'vault.json'), '');
		const b = open();
		expect(b.credentials.locked).toBe(true);
		expect(() => b.credentials.set(ID, 'x')).toThrow();
		expect(text(join(dir, 'credentials.json'))).toBe(sealed);
	});

	it('a trashed account keeps its password sealed, and gives it back once unlocked', () => {
		const { dir, open } = folder();
		const a = open();
		a.vault.setUp(PW);
		const id = a.trash.put(ID, maFile, 'hunter2-secret');
		expect(readFileSync(join(dir, 'trash', `${id}.json`), 'utf8')).not.toContain('hunter2');
		expect(a.trash.list()[0]!.hasPassword).toBe(true);
		expect(a.trash.read(id).password).toBe('hunter2-secret');

		const b = open();
		expect(() => b.trash.read(id)).toThrow('Locked');
		b.vault.unlock(PW);
		expect(b.trash.read(id).password).toBe('hunter2-secret');

		b.trash.convert(false);
		expect(readFileSync(join(dir, 'trash', `${id}.json`), 'utf8')).toContain('hunter2-secret');
		b.trash.convert(true);
		expect(readFileSync(join(dir, 'trash', `${id}.json`), 'utf8')).not.toContain('hunter2');
	});
});

describe('PIN on this PC', () => {
	const fast = { N: 1024, r: 8, p: 1 };
	function pinSetup() {
		const dir = mkdtempSync(join(tmpdir(), 'pin-'));
		const vault = new Vault(join(dir, 'folder', 'vault.json'));
		vault.setUp(PW);
		const device = join(dir, 'device');
		const pin = new DevicePin(device, () => vault.id, fast);
		return { dir, vault, device, pin };
	}

	it('opens the vault without the master password, on this PC only', () => {
		const { vault, pin, device } = pinSetup();
		pin.set('246810', vault.exportKey());
		expect(pin.isSet()).toBe(true);

		const reopened = new Vault(vault.file);
		expect(reopened.isUnlocked()).toBe(false);
		reopened.unlockWithKey(new DevicePin(device, () => reopened.id, fast).unlock('246810'));
		expect(reopened.isUnlocked()).toBe(true);
		expect(reopened.seal('x', 'hello')).toBeTruthy();
		// The key it released really is the vault's: it opens what the password-unlocked vault sealed.
		expect(reopened.openEnvelope('x', JSON.parse(vault.seal('x', 'hello')))).toBe('hello');
	});

	it('a copy of the program folder has no PIN', () => {
		const { vault, pin } = pinSetup();
		pin.set('246810', vault.exportKey());
		const elsewhere = new DevicePin(join(mkdtempSync(join(tmpdir(), 'other-pc-')), 'device'), () => vault.id, fast);
		expect(elsewhere.isSet()).toBe(false);
		expect(() => elsewhere.unlock('246810')).toThrow('No PIN');
	});

	it('counts down wrong tries, then removes the PIN', () => {
		const { vault, pin } = pinSetup();
		pin.set('246810', vault.exportKey());
		expect(() => pin.unlock('000000')).toThrow('4 tries left');
		expect(pin.attemptsLeft()).toBe(4);
		pin.unlock('246810');
		expect(pin.attemptsLeft()).toBe(5);
		for (let i = 0; i < 4; i++) expect(() => pin.unlock('111111')).toThrow('Wrong PIN');
		expect(() => pin.unlock('111111')).toThrow('Too many');
		expect(pin.isSet()).toBe(false);
		expect(() => pin.unlock('246810')).toThrow('No PIN');
	});

	it('only accepts digits, 4 to 12 of them', () => {
		const { vault, pin } = pinSetup();
		for (const bad of ['123', 'abcd12', '1234567890123', '12 34']) expect(() => pin.set(bad, vault.exportKey())).toThrow('4 to 12 digits');
	});

	it('does not store the key in the clear', () => {
		const { vault, pin, device } = pinSetup();
		const key = vault.exportKey();
		pin.set('246810', key);
		const file = join(device, `pin-${vault.id}.json`);
		expect(text(file)).not.toContain(key.toString('base64'));
		expect(text(file)).not.toContain(key.toString('hex'));
	});
});
