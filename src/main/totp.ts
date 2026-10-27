import { createHmac } from 'node:crypto';

// Steam Guard is RFC 6238 TOTP (HMAC-SHA1, 30 s window) rendered in base 26
// over Steam's own alphabet instead of decimal digits.
const ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';
export const WINDOW_SECONDS = 30;

const HEX_SECRET = /^[0-9a-f]{40}$/i;

/** Decode a base64 (or 40-char hex) secret and refuse anything that isn't one. */
export function decodeSecret(secret: string): Buffer {
	const s = secret.trim();
	if (HEX_SECRET.test(s)) return Buffer.from(s, 'hex');
	const buf = Buffer.from(s, 'base64');
	// Buffer.from silently drops invalid characters; re-encode to detect that.
	if (s === '' || buf.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) {
		throw new Error('secret is not valid base64');
	}
	return buf;
}

export function generateCode(sharedSecret: string, unixSeconds: number): string {
	const key = decodeSecret(sharedSecret);
	const counter = Buffer.alloc(8);
	const step = Math.floor(unixSeconds / WINDOW_SECONDS);
	counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
	counter.writeUInt32BE(step >>> 0, 4);

	const mac = createHmac('sha1', key).update(counter).digest();
	const offset = (mac[19] ?? 0) & 0x0f;
	let value =
		(((mac[offset] ?? 0) & 0x7f) << 24) |
		((mac[offset + 1] ?? 0) << 16) |
		((mac[offset + 2] ?? 0) << 8) |
		(mac[offset + 3] ?? 0);

	let code = '';
	for (let i = 0; i < 5; i++) {
		code += ALPHABET[value % ALPHABET.length];
		value = Math.floor(value / ALPHABET.length);
	}
	return code;
}

/** Seconds left in the current window. */
export function secondsRemaining(unixSeconds: number): number {
	return WINDOW_SECONDS - (Math.floor(unixSeconds) % WINDOW_SECONDS);
}
