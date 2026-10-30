import { UserError } from './errors';
import { decodeSecret } from './totp';

export interface ParsedMaFile {
	steamId: string;
	accountName: string;
	sharedSecret: string;
	identitySecret: string;
	revocationCode?: string;
	/** From the maFile's own Session block, when it has one. */
	refreshToken?: string;
	/** The original text, stored verbatim so export stays lossless. */
	raw: string;
}

export class MaFileError extends UserError {}

/**
 * Parse an SDA-style maFile.
 *
 * SteamID64 exceeds Number.MAX_SAFE_INTEGER, so it is pulled out of the raw
 * text with a regex instead of trusting JSON.parse, which would round it.
 */
export function parseMaFile(text: string, hintSteamId?: string): ParsedMaFile {
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new MaFileError('Not valid JSON (encrypted SDA files are not supported yet)');
	}
	if (typeof json !== 'object' || json === null) throw new MaFileError('Not a maFile');

	const sharedSecret = json['shared_secret'];
	const identitySecret = json['identity_secret'];
	const accountName = json['account_name'];
	if (typeof sharedSecret !== 'string') throw new MaFileError('Missing shared_secret');
	if (typeof identitySecret !== 'string') throw new MaFileError('Missing identity_secret');
	try {
		decodeSecret(sharedSecret);
		decodeSecret(identitySecret);
	} catch {
		throw new MaFileError('Secrets are not valid base64');
	}

	// Most files carry it in the Session block. Older or logged-out files may not, so look at what else can tell.
	let steamId = /"SteamID"\s*:\s*"?(\d{17})"?/.exec(text)?.[1];
	let raw = text;
	if (!steamId) {
		steamId = findSteamId(text, json) ?? (hintSteamId && /^\d{17}$/.test(hintSteamId) ? hintSteamId : undefined);
		if (!steamId) {
			throw new MaFileError('No SteamID in this file. Use Add account, then Import with secrets, and enter the username, password and both secrets');
		}
		raw = withSteamId(json, steamId);
	}

	const session = json['Session'];
	const refreshToken =
		typeof session === 'object' && session !== null
			? (session as Record<string, unknown>)['RefreshToken']
			: undefined;
	const revocation = json['revocation_code'];

	return {
		steamId,
		...(typeof revocation === 'string' && revocation ? { revocationCode: revocation } : {}),
		...(typeof refreshToken === 'string' && refreshToken ? { refreshToken } : {}),
		accountName: typeof accountName === 'string' && accountName ? accountName : steamId,
		sharedSecret,
		identitySecret,
		raw
	};
}

/** Other places a maFile can hold the SteamID64: a lowercase key, a login cookie, or a token's subject. */
function findSteamId(text: string, json: Record<string, unknown>): string | undefined {
	const key = /"steam_?id"\s*:\s*"?(\d{17})"?/i.exec(text)?.[1];
	if (key) return key;
	const session = typeof json['Session'] === 'object' && json['Session'] !== null ? (json['Session'] as Record<string, unknown>) : {};
	for (const field of ['SteamLoginSecure', 'SteamLogin']) {
		const v = session[field];
		const m = typeof v === 'string' ? /^(\d{17})(?:%7C%7C|\|\|)/i.exec(v) : null;
		if (m?.[1]) return m[1];
	}
	for (const field of ['RefreshToken', 'AccessToken']) {
		const v = session[field];
		const seg = typeof v === 'string' ? v.split('.')[1] : undefined;
		if (!seg) continue;
		try {
			const sub = (JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as { sub?: unknown }).sub;
			if (typeof sub === 'string' && /^\d{17}$/.test(sub)) return sub;
		} catch {
			/* not a token */
		}
	}
	return undefined;
}

/** The file with the SteamID added to its Session block, written as a number the way SDA does. */
function withSteamId(json: Record<string, unknown>, steamId: string): string {
	const session = typeof json['Session'] === 'object' && json['Session'] !== null ? (json['Session'] as Record<string, unknown>) : {};
	const next = { ...json, Session: { ...session, SteamID: steamId } };
	return JSON.stringify(next, null, 2).replace(/"SteamID": "(\d{17})"/, '"SteamID": $1');
}

/** SDA's manifest.json lists each file with its SteamID; the number is read as text because it is too big for JSON.parse. */
export function steamIdFromManifest(manifestText: string, fileName: string): string | undefined {
	const wanted = fileName.toLowerCase();
	for (const block of manifestText.match(/\{[^{}]*\}/g) ?? []) {
		const name = /"filename"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(block)?.[1];
		if (name?.toLowerCase() !== wanted) continue;
		const id = /"steamid"\s*:\s*"?(\d{17})"?/i.exec(block)?.[1];
		if (id) return id;
	}
	return undefined;
}
