import { parseTradeLink } from './trade';
import { cleanFields } from './exporter';
import { writeFileAtomic } from './atomic';
import { existsSync, readFileSync } from 'node:fs';

export const SORT_OPTIONS = ['added-asc', 'added-desc', 'name-asc', 'name-desc', 'pending'] as const;
export type SortBy = (typeof SORT_OPTIONS)[number];
export const LAYOUT_OPTIONS = ['list', 'columns', 'grid'] as const;
export type Layout = (typeof LAYOUT_OPTIONS)[number];

export interface Settings {
	theme: 'system' | 'dark' | 'light';
	/** The side menu shows only icons. */
	sidebarCollapsed: boolean;
	/** Read VAC and trade ban state from the public profile (no extra request). */
	checkBans: boolean;
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
	/** Ask GitHub once a day whether a newer release exists. Nothing is downloaded. */
	checkUpdates: boolean;
	/** Order of the account list. */
	sortBy: SortBy;
	/** How the accounts are arranged on the Codes page. */
	layout: Layout;
	/** A version the user chose to hide the notice for. */
	updateDismissed: string;
	/** The "add an API key" banner on the Codes page was dismissed. */
	hideKeyHint: boolean;
	/** Trade links kept for sending items. */
	tradeLinks: { name: string; link: string }[];
}

export const DEFAULTS: Settings = {
	theme: 'system',
	checkBans: true,
	sidebarCollapsed: true,
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
	exportSkipIncomplete: false,
	checkUpdates: true,
	sortBy: 'added-asc',
	layout: 'list',
	updateDismissed: '',
	hideKeyHint: false,
	tradeLinks: []
};

const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T =>
	(allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

/** Anything unknown or malformed falls back to the default; nothing from disk is trusted. */
export function sanitize(input: unknown): Settings {
	const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
	return {
		theme: oneOf(o['theme'], ['system', 'dark', 'light'] as const, DEFAULTS.theme),
		checkBans: typeof o['checkBans'] === 'boolean' ? o['checkBans'] : DEFAULTS.checkBans,
		sidebarCollapsed: typeof o['sidebarCollapsed'] === 'boolean' ? o['sidebarCollapsed'] : DEFAULTS.sidebarCollapsed,
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
		sortBy: oneOf(o['sortBy'], SORT_OPTIONS, DEFAULTS.sortBy),
		layout: oneOf(o['layout'], LAYOUT_OPTIONS, DEFAULTS.layout),
		checkUpdates: typeof o['checkUpdates'] === 'boolean' ? o['checkUpdates'] : DEFAULTS.checkUpdates,
		tradeLinks: cleanLinks(o['tradeLinks']),
		hideKeyHint: typeof o['hideKeyHint'] === 'boolean' ? o['hideKeyHint'] : DEFAULTS.hideKeyHint,
		updateDismissed: typeof o['updateDismissed'] === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(o['updateDismissed']) ? o['updateDismissed'] : '',
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
		writeFileAtomic(this.file, JSON.stringify(this.current, null, 2), { backup: true });
		return this.current;
	}
}

function cleanLinks(v: unknown): { name: string; link: string }[] {
	if (!Array.isArray(v)) return [];
	const out: { name: string; link: string }[] = [];
	for (const x of v) {
		const o = (x ?? {}) as Record<string, unknown>;
		if (typeof o['name'] !== 'string' || typeof o['link'] !== 'string') continue;
		try {
			parseTradeLink(o['link']);
		} catch {
			continue;
		}
		out.push({ name: o['name'].trim().slice(0, 30) || 'Trade link', link: o['link'].trim() });
	}
	return out.slice(0, 10);
}
