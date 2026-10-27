import { UserError } from './errors';
import { deviceId } from './confirmations';
import { decodeSecret } from './totp';

export interface LineEntry {
	username: string;
	password: string;
	sharedSecret: string;
	identitySecret: string;
}

export interface LineResult {
	/** What to show for the line: the username, or "Line 3" when it has none. */
	label: string;
	ok: boolean;
	message: string;
}

/**
 * One account per line: username:password:shared_secret:identity_secret.
 * The separator may be any of : ; , | tab. The two secrets are base64 and cannot contain
 * a separator, so they are taken from the right and whatever is left in the middle is the
 * password (which may contain the separator itself).
 */
export function parseLines(text: string, separator: string): { entries: { line: number; entry: LineEntry }[]; errors: { line: number; label: string; message: string }[] } {
	const entries: { line: number; entry: LineEntry }[] = [];
	const errors: { line: number; label: string; message: string }[] = [];
	text.split(/\r?\n/).forEach((raw, i) => {
		const line = i + 1;
		const t = raw.trim();
		if (!t) return;
		const parts = t.split(separator);
		const label = parts[0]?.trim() || `Line ${line}`;
		if (parts.length < 4) return void errors.push({ line, label, message: 'Needs 4 values: username, password, shared_secret, identity_secret' });
		const identitySecret = parts[parts.length - 1]!.trim();
		const sharedSecret = parts[parts.length - 2]!.trim();
		const username = parts[0]!.trim();
		const password = parts.slice(1, -2).join(separator);
		if (!username) return void errors.push({ line, label, message: 'The username is empty' });
		if (!password) return void errors.push({ line, label, message: 'The password is empty' });
		try {
			decodeSecret(sharedSecret);
			decodeSecret(identitySecret);
			if (sharedSecret.length < 16 || identitySecret.length < 16) throw new Error('short');
		} catch {
			return void errors.push({ line, label, message: 'The secrets are not valid. Check the order: shared_secret first, then identity_secret' });
		}
		entries.push({ line, entry: { username, password, sharedSecret, identitySecret } });
	});
	return { entries, errors };
}

/** SteamID64 from a refresh token (its subject). */
export function steamIdFromToken(token: string): string | undefined {
	const seg = token.split('.')[1];
	if (!seg) return undefined;
	try {
		const sub = (JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as { sub?: unknown }).sub;
		return typeof sub === 'string' && /^\d{17}$/.test(sub) ? sub : undefined;
	} catch {
		return undefined;
	}
}

/** The maFile as SDA writes it, with what is known. SteamID is a number, as SDA expects. */
export function buildMaFile(e: LineEntry, steamId: string, refreshToken: string): string {
	const obj = {
		shared_secret: e.sharedSecret,
		serial_number: '',
		revocation_code: '',
		uri: '',
		server_time: '',
		account_name: e.username,
		token_gid: '',
		identity_secret: e.identitySecret,
		secret_1: '',
		status: 1,
		device_id: deviceId(steamId),
		phone_number_hint: '',
		confirm_type: 1,
		fully_enrolled: true,
		Session: { SteamID: steamId, RefreshToken: refreshToken }
	};
	return JSON.stringify(obj, null, 2).replace(/"SteamID": "(\d{17})"/, '"SteamID": $1');
}

export interface LineImportDeps {
	signIn: (username: string, password: string, sharedSecret: string, nowSec: number) => Promise<string>;
	steamNow: () => number;
	/** Already in the app, or in the trash. */
	exists: (steamId: string) => boolean;
	save: (steamId: string, maFile: string, password: string, refreshToken: string) => void;
	pause?: (ms: number) => Promise<void>;
}

/** Signs in once per line to learn the SteamID64, then writes the maFile. Sequential, with a pause, to stay gentle on Steam. */
export async function importLines(text: string, separator: string, d: LineImportDeps): Promise<LineResult[]> {
	if (![':', ';', ',', '|', '\t'].includes(separator)) throw new UserError('Unsupported separator');
	const { entries, errors } = parseLines(text, separator);
	const results: (LineResult & { line: number })[] = errors.map((e) => ({ line: e.line, label: e.label, ok: false, message: e.message }));
	if (entries.length > 50) throw new UserError('At most 50 accounts at a time');
	const pause = d.pause ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
	let first = true;
	for (const { line, entry } of entries) {
		if (!first) await pause(2000);
		first = false;
		try {
			const refresh = await d.signIn(entry.username, entry.password, entry.sharedSecret, d.steamNow());
			const steamId = steamIdFromToken(refresh);
			if (!steamId) throw new UserError('Steam did not say which account this is');
			if (d.exists(steamId)) {
				results.push({ line, label: entry.username, ok: false, message: 'Already in the app (or in the trash)' });
				continue;
			}
			d.save(steamId, buildMaFile(entry, steamId, refresh), entry.password, refresh);
			results.push({ line, label: entry.username, ok: true, message: `Added (${steamId})` });
		} catch (err) {
			results.push({ line, label: entry.username, ok: false, message: err instanceof UserError ? err.message : 'Sign-in failed' });
		}
	}
	return results.sort((a, b) => a.line - b.line).map(({ label, ok, message }) => ({ label, ok, message }));
}
