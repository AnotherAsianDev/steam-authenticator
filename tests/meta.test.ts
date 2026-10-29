import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccountMeta, cleanNote, NOTE_MAX } from '../src/main/meta';

const ID = '76561199000000001';
const file = () => join(mkdtempSync(join(tmpdir(), 'meta-')), 'meta.json');

describe('account meta', () => {
	it('stores pin and note and reloads them', () => {
		const f = file();
		const m = new AccountMeta(f);
		m.set(ID, { pinned: true, note: '  trade   alt ' });
		const again = new AccountMeta(f);
		expect(again.get(ID)).toEqual({ pinned: true, note: 'trade alt' });
	});
	it('drops an entry that is neither pinned nor noted', () => {
		const f = file();
		const m = new AccountMeta(f);
		m.set(ID, { pinned: true });
		m.set(ID, { pinned: false });
		expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({});
	});
	it('cleans notes', () => {
		expect(cleanNote('a\nb\u0000c')).toBe('a b c');
		expect(cleanNote('x'.repeat(500))).toHaveLength(NOTE_MAX);
		expect(cleanNote(42)).toBe('');
	});
	it('survives a damaged file by using the .bak copy, or starting empty', () => {
		const f = file();
		writeFileSync(f, '{broken');
		expect(new AccountMeta(f).get(ID).pinned).toBe(false);
		writeFileSync(`${f}.bak`, JSON.stringify({ [ID]: { pinned: true, note: '' } }));
		expect(new AccountMeta(f).get(ID).pinned).toBe(true);
	});
});
