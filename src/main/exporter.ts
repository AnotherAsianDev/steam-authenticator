import { UserError } from './errors';

export const FIELD_KEYS = ['username', 'password', 'steamId', 'sharedSecret', 'identitySecret', 'revocationCode'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface ExportRow {
	username: string;
	password?: string | undefined;
	steamId: string;
	sharedSecret: string;
	identitySecret: string;
	revocationCode?: string | undefined;
}

export interface ExportResult {
	text: string;
	/** Lines written. */
	count: number;
	/** Accounts left out because a chosen field was missing. */
	skipped: number;
	/** Values that contain the delimiter, which would make the line ambiguous to read back. */
	conflicts: number;
}

export function cleanFields(input: unknown): FieldKey[] {
	if (!Array.isArray(input)) return [];
	return [...new Set(input.filter((f): f is FieldKey => (FIELD_KEYS as readonly unknown[]).includes(f)))];
}

export function cleanDelimiter(input: unknown): string {
	if (typeof input !== 'string' || input.length === 0 || input.length > 5 || /[\r\n]/.test(input)) {
		throw new UserError('Choose a separator of 1 to 5 characters');
	}
	return input;
}

/** One line per account, chosen fields in the chosen order, joined by the separator. */
export function buildExport(rows: ExportRow[], fields: FieldKey[], delimiter: string, skipIncomplete: boolean): ExportResult {
	if (fields.length === 0) throw new UserError('Choose at least one field');
	const lines: string[] = [];
	let skipped = 0;
	let conflicts = 0;
	for (const row of rows) {
		const values = fields.map((f) => row[f] ?? '');
		if (skipIncomplete && values.some((v) => v === '')) {
			skipped++;
			continue;
		}
		conflicts += values.filter((v) => v.includes(delimiter)).length;
		lines.push(values.join(delimiter));
	}
	return { text: lines.join('\n'), count: lines.length, skipped, conflicts };
}

/** Insert or replace the revocation code without touching anything else in the file (SteamID stays exact). */
export function withRevocationCode(raw: string, code: string): string {
	if (!/^R\d{4,6}$/.test(code)) throw new UserError('A revocation code looks like R12345');
	if (/"revocation_code"\s*:\s*"[^"]*"/.test(raw)) return raw.replace(/("revocation_code"\s*:\s*)"[^"]*"/, `$1"${code}"`);
	if (!/^\s*\{/.test(raw)) throw new UserError('Not a maFile');
	return raw.replace(/^(\s*\{)/, `$1"revocation_code":"${code}",`);
}
