import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AddedDates } from '../src/main/addeddates';
import { sanitize } from '../src/main/settings';

const A = '76561198000000001';
const B = '76561198000000002';
const file = () => join(mkdtempSync(join(tmpdir(), 'added-')), 'added.json');

describe('AddedDates', () => {
	it('uses the file time for an account it has not seen, then keeps it', () => {
		const f = file();
		const d = new AddedDates(f);
		expect(d.get(A, () => 1000)).toBe(1000);
		expect(d.get(A, () => 9999)).toBe(1000);
		d.save([A]);
		expect(new AddedDates(f).get(A, () => 5)).toBe(1000);
	});
	it('falls back to now when the file time is unknown', () => {
		const t = new AddedDates(file()).get(A, () => undefined);
		expect(Math.abs(t - Date.now())).toBeLessThan(5000);
	});
	it('forgets removed accounts, and survives a damaged file', () => {
		const f = file();
		const d = new AddedDates(f);
		d.get(A, () => 1);
		d.get(B, () => 2);
		d.save([A]);
		expect(Object.keys(JSON.parse(readFileSync(f, 'utf8')))).toEqual([A]);
		writeFileSync(f, '{broken');
		expect(new AddedDates(f).get(A, () => 7)).toBe(7);
	});
});

describe('sort setting', () => {
	it('accepts the known orders and falls back for anything else', () => {
		expect(sanitize({ sortBy: 'name-desc' }).sortBy).toBe('name-desc');
		expect(sanitize({ sortBy: 'nope' }).sortBy).toBe('added-asc');
		expect(sanitize({}).sortBy).toBe('added-asc');
	});
});
