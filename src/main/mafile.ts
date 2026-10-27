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
export function parseMaFile(text: string): ParsedMaFile {
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

	const match = /"SteamID"\s*:\s*"?(\d{17})"?/.exec(text);
	if (!match?.[1]) throw new MaFileError('Missing SteamID');

	const session = json['Session'];
	const refreshToken =
		typeof session === 'object' && session !== null
			? (session as Record<string, unknown>)['RefreshToken']
			: undefined;
	const revocation = json['revocation_code'];

	return {
		steamId: match[1],
		...(typeof revocation === 'string' && revocation ? { revocationCode: revocation } : {}),
		...(typeof refreshToken === 'string' && refreshToken ? { refreshToken } : {}),
		accountName: typeof accountName === 'string' && accountName ? accountName : match[1],
		sharedSecret,
		identitySecret,
		raw: text
	};
}
