import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport, cleanDelimiter, cleanFields, withRevocationCode, type ExportRow } from '../src/main/exporter';
import { migrateLegacy, resolveLayout } from '../src/main/paths';
import { parseMaFile } from '../src/main/mafile';
import { sanitize } from '../src/main/settings';

const rows: ExportRow[] = [
	{ username: 'alice', password: 'pw:1', steamId: '76561198000000001', sharedSecret: 'SS1', identitySecret: 'IS1', revocationCode: 'R11111' },
	{ username: 'bob', steamId: '76561198000000002', sharedSecret: 'SS2', identitySecret: 'IS2' }
];

describe('export', () => {
	it('uses the chosen fields, order and separator', () => {
		const r = buildExport(rows, ['username', 'password', 'sharedSecret', 'identitySecret'], ';', false);
		expect(r.text).toBe('alice;pw:1;SS1;IS1\nbob;;SS2;IS2');
		expect(buildExport(rows, ['sharedSecret', 'username'], '\t', false).text).toBe('SS1\talice\nSS2\tbob');
	});
	it('can leave out accounts with a missing value', () => {
		const r = buildExport(rows, ['username', 'password'], ':', true);
		expect(r).toMatchObject({ text: 'alice:pw:1', count: 1, skipped: 1 });
	});
	it('warns when a value contains the separator', () => {
		expect(buildExport(rows, ['username', 'password'], ':', false).conflicts).toBe(1);
		expect(buildExport(rows, ['username', 'password'], '|', false).conflicts).toBe(0);
	});
	it('rejects bad input', () => {
		expect(cleanFields(['username', 'nope', 'username', 7])).toEqual(['username']);
		expect(() => cleanDelimiter('')).toThrow();
		expect(() => cleanDelimiter('a\nb')).toThrow();
		expect(() => cleanDelimiter('123456')).toThrow();
		expect(() => buildExport(rows, [], ':', false)).toThrow();
	});
	it('settings keep only valid export choices', () => {
		const s = sanitize({ exportFields: ['password', 'x', 'username'], exportDelimiter: '\n', todoIgnored: ['76561198000000001:password', 'bad'] });
		expect(s.exportFields).toEqual(['password', 'username']);
		expect(s.exportDelimiter).toBe(':');
		expect(s.todoIgnored).toEqual(['76561198000000001:password']);
	});
});

describe('revocation code', () => {
	const SEC = Buffer.from('0123456789abcdef0123').toString('base64');
	const base = `{"shared_secret":"${SEC}","identity_secret":"${SEC}","account_name":"a","Session":{"SteamID":76561198000000001}}`;
	it('inserts one and keeps the SteamID exact', () => {
		const out = withRevocationCode(base, 'R12345');
		expect(out).toContain('76561198000000001');
		expect(parseMaFile(out)).toMatchObject({ revocationCode: 'R12345', steamId: '76561198000000001' });
	});
	it('replaces an existing one and rejects nonsense', () => {
		const once = withRevocationCode(base, 'R12345');
		expect(parseMaFile(withRevocationCode(once, 'R99999')).revocationCode).toBe('R99999');
		expect(() => withRevocationCode(base, 'hello')).toThrow();
	});
});

describe('portable layout', () => {
	it('keeps maFiles next to the program, behind the launcher', () => {
		const root = mkdtempSync(join(tmpdir(), 'portable-'));
		mkdirSync(join(root, 'app'));
		const l = resolveLayout(true, join(root, 'app', 'Authenticator.exe'), join(root, 'legacy'));
		expect(l).toMatchObject({ portable: true, maFiles: join(root, 'maFiles'), data: join(root, 'data') });
	});
	it('uses the user folder when not packaged', () => {
		expect(resolveLayout(false, '/x/electron', '/home/u/.config/app')).toMatchObject({ portable: false, maFiles: '/home/u/.config/app/maFiles' });
	});
	it('copies the old data over once and never overwrites', () => {
		const root = mkdtempSync(join(tmpdir(), 'portable-'));
		const legacy = join(root, 'legacy');
		mkdirSync(join(legacy, 'maFiles'), { recursive: true });
		writeFileSync(join(legacy, 'maFiles', '76561198000000001.maFile'), '{}');
		writeFileSync(join(legacy, 'credentials.json'), '{"a":"b"}');
		mkdirSync(join(root, 'app'));
		const l = resolveLayout(true, join(root, 'app', 'A.exe'), legacy);
		expect(migrateLegacy(legacy, l)).toEqual(['maFiles', 'credentials.json']);
		expect(readFileSync(join(l.data, 'credentials.json'), 'utf8')).toBe('{"a":"b"}');
		expect(existsSync(join(legacy, 'credentials.json'))).toBe(true);
		writeFileSync(join(l.data, 'settings.json'), '{}');
		expect(migrateLegacy(legacy, l)).toEqual([]);
	});
});
