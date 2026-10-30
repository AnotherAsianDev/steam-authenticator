import { describe, expect, it } from 'vitest';
import { openBackup, sealBackup, type BackupContent } from '../src/main/backup';

const content: BackupContent = {
	version: 1,
	createdAt: '2026-10-30T10:00:00Z',
	accounts: [{ steamId: '76561198000000001', maFile: '{"shared_secret":"x"}', password: 'pw', meta: { pinned: true, note: 'alt', tags: ['trade'], skipBulk: false } }]
};

describe('backup', () => {
	it('round-trips with the right password', () => {
		const file = sealBackup(content, 'correct horse');
		expect(openBackup(file, 'correct horse')).toEqual(content);
	});
	it('does not contain secrets in readable form', () => {
		expect(sealBackup(content, 'correct horse').toString('latin1')).not.toContain('shared_secret');
	});
	it('refuses a wrong password and a short one', () => {
		const file = sealBackup(content, 'correct horse');
		expect(() => openBackup(file, 'wrong password')).toThrow(/Wrong password/);
		expect(() => sealBackup(content, 'short')).toThrow(/at least/);
	});
	it('refuses other files and tampering', () => {
		expect(() => openBackup(Buffer.from('hello'), 'x')).toThrow(/not a backup/);
		const file = sealBackup(content, 'correct horse');
		file[file.length - 1] = file[file.length - 1]! ^ 1;
		expect(() => openBackup(file, 'correct horse')).toThrow(/Wrong password/);
	});
	it('drops accounts with bad ids', () => {
		const bad = { ...content, accounts: [...content.accounts, { steamId: '12', maFile: '{}' }] };
		expect(openBackup(sealBackup(bad, 'correct horse'), 'correct horse').accounts).toHaveLength(1);
	});
});
