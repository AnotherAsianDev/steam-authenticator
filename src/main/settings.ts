import { cleanFields } from './exporter';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface Settings {
	theme: 'system' | 'dark' | 'light';
	density: 'comfortable' | 'compact';
	showSteamId: boolean;
	showAvatars: boolean;
	/** Show the Steam profile name instead of the login name; the login name moves to the second line. */
	showNickname: boolean;
	/** How often pending confirmations are checked in the background. 0 = only when asked. */
	autoCheckSeconds: 0 | 300 | 900 | 1800;
	/** Check confirmations once when the app starts. */
	checkOnStartup: boolean;
	/** How long a copied code or secret stays on the clipboard. 0 = leave it. */
	clipboardClearSeconds: 0 | 15 | 30 | 60;
	/** Look for SDA maFiles folders in Downloads, Desktop and Documents on startup. */
	autoDetect: boolean;
	/** Extra folders whose maFiles are imported automatically. */
	importFolders: string[];
	/** To-do items the user chose to hide, as `steamId:kind`. */
	todoIgnored: string[];
	exportFields: string[];
	exportDelimiter: string;
	exportSkipIncomplete: boolean;
}

export const DEFAULTS: Settings = {
	theme: 'system',
	density: 'comfortable',
	showSteamId: false,
	showAvatars: true,
	showNickname: false,
	autoCheckSeconds: 0,
	checkOnStartup: true,
	clipboardClearSeconds: 30,
	autoDetect: true,
	importFolders: [],
	todoIgnored: [],
	exportFields: ['username', 'password', 'sharedSecret', 'identitySecret'],
	exportDelimiter: ':',
	exportSkipIncomplete: false
};

const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T =>
	(allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

/** Anything unknown or malformed falls back to the default; nothing from disk is trusted. */
export function sanitize(input: unknown): Settings {
	const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
	return {
		theme: oneOf(o['theme'], ['system', 'dark', 'light'] as const, DEFAULTS.theme),
		density: oneOf(o['density'], ['comfortable', 'compact'] as const, DEFAULTS.density),
		showSteamId: typeof o['showSteamId'] === 'boolean' ? o['showSteamId'] : DEFAULTS.showSteamId,
		showAvatars: typeof o['showAvatars'] === 'boolean' ? o['showAvatars'] : DEFAULTS.showAvatars,
		showNickname: typeof o['showNickname'] === 'boolean' ? o['showNickname'] : DEFAULTS.showNickname,
		autoCheckSeconds: oneOf(o['autoCheckSeconds'], [0, 300, 900, 1800] as const, DEFAULTS.autoCheckSeconds),
		checkOnStartup: typeof o['checkOnStartup'] === 'boolean' ? o['checkOnStartup'] : DEFAULTS.checkOnStartup,
		clipboardClearSeconds: oneOf(o['clipboardClearSeconds'], [0, 15, 30, 60] as const, DEFAULTS.clipboardClearSeconds),
		autoDetect: typeof o['autoDetect'] === 'boolean' ? o['autoDetect'] : DEFAULTS.autoDetect,
		todoIgnored: Array.isArray(o['todoIgnored'])
			? [...new Set(o['todoIgnored'].filter((x): x is string => typeof x === 'string' && /^\d{17}:[a-z]{3,12}$/.test(x)))].slice(0, 500)
			: [],
		exportFields: Array.isArray(o['exportFields']) ? cleanFields(o['exportFields']) : DEFAULTS.exportFields,
		exportDelimiter:
			typeof o['exportDelimiter'] === 'string' && o['exportDelimiter'].length >= 1 && o['exportDelimiter'].length <= 5 && !/[\r\n]/.test(o['exportDelimiter'])
				? o['exportDelimiter']
				: DEFAULTS.exportDelimiter,
		exportSkipIncomplete: typeof o['exportSkipIncomplete'] === 'boolean' ? o['exportSkipIncomplete'] : DEFAULTS.exportSkipIncomplete,
		importFolders: Array.isArray(o['importFolders'])
			? [...new Set(o['importFolders'].filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 1024))].slice(0, 20)
			: []
	};
}

export class SettingsStore {
	private current: Settings;
	constructor(private readonly file: string) {
		let raw: unknown;
		try {
			raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
		} catch {
			raw = {};
		}
		this.current = sanitize(raw);
	}
	get(): Settings {
		return this.current;
	}
	update(patch: unknown): Settings {
		const p = typeof patch === 'object' && patch !== null ? patch : {};
		this.current = sanitize({ ...this.current, ...p });
		const tmp = `${this.file}.tmp`;
		writeFileSync(tmp, JSON.stringify(this.current, null, 2));
		renameSync(tmp, this.file);
		return this.current;
	}
}
