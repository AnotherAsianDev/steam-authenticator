import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, shell } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Accounts } from './accounts';
import { describeWriteError } from './atomic';
import { AccountMeta } from './meta';
import { UserError } from './errors';
import { AvatarCache, banLabels, type Bans } from './avatar';
import { fetchBans, KEY_FORMAT, testKey } from './bansapi';
import { findMaFileFolders, importFolder, normalizeStoreFolder, readMaFile } from './autoimport';
import { CredentialStore } from './credentials';
import { FolderWatcher } from './watcher';
import { clockOffset, steamNow, syncClock } from './clock';
import { GAMES, accountIdOf, chunk, fetchHttp, fetchInventory, fetchOwnTradeLink, parseTradeLink, sendOffer, type TradeLink } from './trade';
import { sessionCookie } from './sessions';
import { ConfirmationsClient, fetchTransport, type Action } from './confirmations';
import { MaFileError, parseMaFile } from './mafile';
import { SettingsStore } from './settings';
import { mintAccessToken, signIn, TokenStore } from './sessions';
import { buildExport, cleanDelimiter, cleanFields, withRevocationCode, type ExportRow } from './exporter';
import { log } from './log';
import { migrateLegacy, resolveLayout } from './paths';
import { openSteamWindow, TARGETS } from './browser';
import { StateCache } from './statecache';
import { Enrollment, httpPost, steamLogin } from './enroll';
import { MaFileStore } from './store';
import { UpdateChecker } from './updatecheck';
import { AddedDates } from './addeddates';
import { importLines, importOne, type LineImportDeps, type LineResult } from './lineimport';
import { Trash } from './trash';
import { checkPin, DevicePin, Vault } from './vault';
import { fitWindowState, loadWindowState, saveWindowState } from './windowstate';
import { decodeSecret, generateCode, secondsRemaining } from './totp';

const legacyData = app.getPath('userData');
const layout = resolveLayout(app.isPackaged, process.execPath, legacyData);
if (layout.portable) app.setPath('userData', layout.chromium);
// One copy per folder: two copies on the same files would overwrite each other.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.exit(0);
const clockReady = syncClock();
const migrated = migrateLegacy(legacyData, layout);
const data = layout.data;
const store = new MaFileStore(layout.maFiles);
const addedDates = new AddedDates(join(layout.data, 'added.json'));
const meta = new AccountMeta(join(layout.data, 'meta.json'));
const vault = new Vault(join(data, 'vault.json'));
// The PIN lives on this PC only, never in the (possibly synced) program folder.
const devicePin = new DevicePin(join(process.env['LOCALAPPDATA'] ?? app.getPath('appData'), 'AuthenticatorDevice'), () => vault.id);
const trash = new Trash(join(data, 'trash'), vault);
log.init(join(data, 'log.jsonl'), () => secretValues(), () => win?.webContents.send('logChanged'));
process.on('uncaughtException', (err) => log.error('app', 'Unexpected error', err));
app.on('render-process-gone', (_e, _wc, details) => {
	log.error('app', `The window process stopped (${details.reason}); reloading it`);
	if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => win?.reload(), 300);
});
app.on('child-process-gone', (_e, details) => log.warn('app', `A helper process stopped (${details.type}: ${details.reason})`));
process.on('unhandledRejection', (err) => log.error('app', 'Unhandled error', err));
const secretValues = (): string[] => {
	const out: string[] = [];
	const apiKey = credentials.get(API_KEY_ID);
	if (apiKey) out.push(apiKey);
	for (const id of accounts.ids()) {
		const a = accounts.get(id)!;
		out.push(a.sharedSecret, a.identitySecret);
		if (a.revocationCode) out.push(a.revocationCode);
		const pw = credentials.get(id);
		if (pw) out.push(pw);
	}
	return out;
};
const settings = new SettingsStore(join(data, 'settings.json'));
let win: BrowserWindow | null = null;

const credentials = new CredentialStore(join(data, 'credentials.json'), vault);
const tokens = new TokenStore(join(data, 'sessions.json'), vault);
const avatars = new AvatarCache(join(data, 'avatars'), () => win?.webContents.send('changed'), undefined, (steamId, what) => {
	const name = accounts.get(steamId)?.accountName ?? steamId;
	log.warn('bans', `${name} now has ${what}`);
	notice(`${name} now has ${what}`, true);
});
const accounts = new Accounts({
	cache: new StateCache(join(data, 'cache.json')),
	store,
	trash,
	tokens,
	credentials,
	client: new ConfirmationsClient(fetchTransport, steamNow),
	steamNow,
	mint: mintAccessToken,
	signInWithPassword: signIn,
	onChange: () => win?.webContents.send('changed')
});

const enrollment = new Enrollment({
	store,
	pendingDir: join(data, 'pending'),
	steamNow,
	newLogin: steamLogin,
	mint: mintAccessToken,
	http: httpPost,
	onTokens: (id, token) => tokens.set(id, token),
	onPassword: (id, pw) => credentials.set(id, pw),
	onAdded: (id) => {
		accounts.reload();
		win?.webContents.send('changed');
		void accounts.refresh(id);
	}
});

function copyText(text: string): void {
	clipboard.writeText(text);
	const seconds = settings.get().clipboardClearSeconds;
	if (seconds > 0) {
		// Only clear if it is still ours, so we never wipe something the user copied since.
		setTimeout(() => {
			if (clipboard.readText() === text) clipboard.clear();
		}, seconds * 1000);
	}
}

function str(v: unknown, what = 'value'): string {
	if (typeof v !== 'string' || v.length === 0 || v.length > 4096) throw new UserError(`Invalid ${what}`);
	return v;
}
function known(steamId: unknown): string {
	const id = str(steamId, 'account');
	if (!accounts.get(id)) throw new UserError('Unknown account');
	return id;
}

/** Anything that reads or writes saved passwords waits for the master password. */
function needUnlocked(): void {
	if (!vault.isUnlocked()) throw new UserError('Locked. Unlock with your master password first');
}
const vaultInfo = () => ({
	enabled: vault.isSetUp(),
	locked: !vault.isUnlocked(),
	pin: vault.isSetUp() && devicePin.isSet(),
	pinTries: devicePin.attemptsLeft()
});
let startupDone = false;
/** One round of checks when the app starts, once the secrets it needs are available. */
function startupCheck(): void {
	if (startupDone || !settings.get().checkOnStartup || !vault.isUnlocked()) return;
	startupDone = true;
	// Confirmation requests are signed with the time, so the clock comes first.
	void clockReady.then(() => accounts.refreshAll(600));
}
function afterUnlock(): void {
	credentials.reload();
	tokens.reload();
	if (credentials.locked || tokens.locked) {
		vault.lock();
		credentials.reload();
		tokens.reload();
		throw new UserError('That key does not open the saved files. Use the master password');
	}
	log.info('vault', 'Unlocked');
	win?.webContents.send('changed');
	startupCheck();
}

function handle<T>(channel: string, fn: (...args: any[]) => T | Promise<T>): void {
	ipcMain.handle(channel, async (event, ...args) => {
		// Only our own window may call in.
		if (event.senderFrame?.url !== win?.webContents.getURL()) throw new Error('Untrusted sender');
		try {
			return { ok: true, value: await fn(...args) };
		} catch (err) {
			if (!(err instanceof UserError)) log.error('app', `Unexpected error in ${channel}`, err);
			const message = err instanceof UserError ? err.message : describeWriteError(err) ?? 'Something went wrong';
			return { ok: false, error: message };
		}
	});
}

/** An account without a saved password is warned about when its sign-in has this many days left. */
const SESSION_WARN_DAYS = 14;
const API_KEY_ID = '_apiKey';
const apiKeyState = (): { has: boolean; locked: boolean; hint: string } => {
	const k = credentials.get(API_KEY_ID);
	return { has: !!k, locked: credentials.locked, hint: k ? `…${k.slice(-4)}` : '' };
};
let apiBansAt = 0;
let apiBansIds = '';
let apiBansBusy = false;
/** With a Web API key, all accounts are asked about in one request every 12 hours, or soon after the account list changes. */
function refreshApiBans(ids: string[]): void {
	const key = credentials.get(API_KEY_ID);
	const on = !!key && settings.get().checkBans;
	avatars.setApiMode(on);
	if (!on || apiBansBusy || ids.length === 0) return;
	const sig = ids.join(',');
	const age = Date.now() - apiBansAt;
	if (age < 12 * 3600_000 && !(sig !== apiBansIds && age > 60_000)) return;
	apiBansBusy = true;
	apiBansAt = Date.now();
	apiBansIds = sig;
	fetchBans(key!, ids)
		.then((found) => {
			for (const [id, b] of Object.entries(found)) if (ids.includes(id)) avatars.setBans(id, b);
		})
		.catch((err) => {
			log.info('bans', `Ban check through the API failed: ${err instanceof Error ? err.message : String(err)}`);
			apiBansAt = Date.now() - 11 * 3600_000; // try again in an hour
		})
		.finally(() => {
			apiBansBusy = false;
		});
}
/** One line about how long ago the last ban was (only known through the API). */
function banNote(b: Bans | undefined): string {
	return b?.daysSince !== undefined ? `Last ban ${b.daysSince === 0 ? 'today' : `${b.daysSince} day${b.daysSince === 1 ? '' : 's'} ago`}.` : '';
}

const publicStatus = (id: string) => {
	const s = accounts.status(id);
	return {
		state: s.state,
		message: s.message,
		unreadable: s.unreadable,
		fetchedAt: s.fetchedAt,
		// Nonces stay in the main process; the window only needs what to display.
		items: s.items.map(({ nonce: _nonce, ...rest }) => rest)
	};
};

/** Copy any new maFiles from the detected and configured folders. */
function autoImport(): { added: string[]; folders: number } {
	const s = settings.get();
	const home = app.getPath('home');
	const detected = s.autoDetect ? findMaFileFolders([join(home, 'Downloads'), join(home, 'Desktop'), join(home, 'Documents')]) : [];
	const folders = [...new Set([...detected, ...s.importFolders])];
	const added: string[] = [];
	const removed = trash.steamIds();
	for (const f of folders) added.push(...importFolder(f, store, removed).added);
	if (added.length) accounts.reload();
	watchFolders(folders);
	return { added, folders: folders.length };
}

function notice(message: string, error = false): void {
	win?.webContents.send('notice', { message, error });
}

let detectedFolders: string[] = [];
const externalFolders = (): string[] => [...new Set([...detectedFolders, ...settings.get().importFolders])];
const watcher = new FolderWatcher((dir) => (dir === store.dir ? processStoreFolder(true) : processExternalFolder(dir)));
function watchFolders(external: string[]): void {
	detectedFolders = external;
	watcher.setFolders([store.dir, ...external]);
}

/** The user dropped something into the app's own folder. */
function processStoreFolder(retryFailures: boolean): void {
	const r = normalizeStoreFolder(store);
	accounts.reload();
	win?.webContents.send('changed');
	if (r.added.length) notice(`Imported ${r.added.join(', ')}`);
	if (r.duplicates.length) notice(`${r.duplicates.length} file(s) skipped: account already exists`, true);
	if (r.failed.length) {
		// A file still being copied can look broken; look once more before complaining.
		if (retryFailures) setTimeout(() => processStoreFolder(false), 3000).unref();
		else notice(`${r.failed[0]!.file}: ${r.failed[0]!.message}`, true);
	}
}

/** New files appeared in a folder the user watches (for example SDA's). */
function processExternalFolder(dir: string): void {
	const r = importFolder(dir, store, trash.steamIds());
	if (r.added.length) {
		accounts.reload();
		win?.webContents.send('changed');
		notice(`Imported ${r.added.join(', ')}`);
	}
}

function registerIpc(): void {
	handle('accounts', async () => {
		// Right after start the clock may not be corrected yet; a wrong code for a second is worse than a short wait.
		await Promise.race([clockReady, new Promise((r) => setTimeout(r, 1500))]);
		const t = steamNow();
		const showAvatars = settings.get().showAvatars;
		const watchBans = settings.get().checkBans;
		const wantProfiles = showAvatars || settings.get().showNickname || watchBans;
		const ids = accounts.ids();
		refreshApiBans(ids);
		const rows = ids.map((steamId) => {
			const a = accounts.get(steamId)!;
			const st = accounts.status(steamId);
			if (wantProfiles) avatars.ensure(steamId, { image: showAvatars, bans: watchBans });
			return {
				steamId,
				addedAt: addedDates.get(steamId, () => store.fileTime(steamId)),
				pinned: meta.get(steamId).pinned,
				note: meta.get(steamId).note,
				name: a.accountName,
				code: generateCode(a.sharedSecret, t),
				remaining: secondsRemaining(t),
				hasAvatar: showAvatars && avatars.has(steamId),
				nickname: avatars.nickname(steamId) ?? null,
				bans: watchBans ? banLabels(avatars.bans(steamId)) : [],
				tags: meta.get(steamId).tags,
				skipBulk: meta.get(steamId).skipBulk,
				sessionDays: accounts.sessionDaysLeft(steamId) ?? null,
				hasPassword: accounts.hasPassword(steamId),
				state: st.state,
				pending: st.state === 'ok' ? st.items.length : null
			};
		});
		// Never prune against an empty list: that is how it looks for a moment while the folder is read.
		if (ids.length) addedDates.save(ids);
		return rows;
	});
	handle('avatar', (steamId: unknown) => avatars.get(known(steamId)) ?? null);

	handle('copyCode', (steamId: unknown) => {
		const a = accounts.get(known(steamId))!;
		copyText(generateCode(a.sharedSecret, steamNow()));
	});
	handle('copyField', (steamId: unknown, field: unknown) => {
		const a = accounts.get(known(steamId))!;
		if (field === 'password') needUnlocked();
		const values: Record<string, string | undefined> = {
			username: a.accountName,
			steamId: a.steamId,
			sharedSecret: a.sharedSecret,
			identitySecret: a.identitySecret,
			revocationCode: a.revocationCode,
			password: credentials.get(a.steamId)
		};
		const v = typeof field === 'string' ? values[field] : undefined;
		if (!v) throw new UserError('Not available for this account');
		copyText(v);
	});
	handle('detail', (steamId: unknown) => {
		const a = accounts.get(known(steamId))!;
		return { steamId: a.steamId, name: a.accountName, nickname: avatars.nickname(a.steamId) ?? null, hasRevocation: !!a.revocationCode, hasPassword: accounts.hasPassword(a.steamId), pinned: meta.get(a.steamId).pinned, note: meta.get(a.steamId).note, tags: meta.get(a.steamId).tags, bans: banLabels(avatars.bans(a.steamId)), banNote: banNote(avatars.bans(a.steamId)), banHistory: avatars.history(a.steamId), sessionDays: accounts.sessionDaysLeft(a.steamId) ?? null };
	});
	handle('apiKeyState', () => apiKeyState());
	handle('apiKeySet', async (key: unknown) => {
		const k = str(key, 'key').trim();
		if (!KEY_FORMAT.test(k)) throw new UserError('A Web API key is 32 characters of 0 to 9 and A to F');
		const r = await testKey(k);
		if (r === 'invalid') throw new UserError('Steam does not accept this key. Check that you copied all of it');
		if (r === 'network') throw new UserError('Could not reach Steam, so the key was not checked or saved');
		credentials.set(API_KEY_ID, k);
		apiBansAt = 0;
		avatars.setApiMode(true);
		return apiKeyState();
	});
	handle('apiKeyTest', async () => {
		const k = credentials.get(API_KEY_ID);
		if (!k) throw new UserError('No key is saved');
		return testKey(k);
	});
	handle('apiKeyRemove', () => {
		credentials.delete(API_KEY_ID);
		avatars.setApiMode(false);
		avatars.refreshAll();
		return apiKeyState();
	});
	handle('apiKeyPage', () => shell.openExternal('https://steamcommunity.com/dev/apikey'));
	handle('setMeta', (steamId: unknown, patch: unknown) => {
		const id = known(steamId);
		if (typeof patch !== 'object' || patch === null) throw new UserError('Invalid change');
		return meta.set(id, patch as { pinned?: unknown; note?: unknown; tags?: unknown; skipBulk?: unknown });
	});
	handle('healthCheck', async () => {
		await syncClock();
		avatars.refreshAll();
		apiBansAt = 0;
		const skew = clockOffset();
		const rows = accounts.ids().map((steamId) => {
			const a = accounts.get(steamId)!;
			const bad: string[] = [];
			const warn: string[] = [];
			try {
				generateCode(a.sharedSecret, steamNow());
			} catch {
				bad.push('The shared secret is not valid, so codes would be wrong');
			}
			try {
				decodeSecret(a.identitySecret);
			} catch {
				warn.push('The identity secret is missing or not valid, so confirmations cannot be signed');
			}
			const st = accounts.status(steamId);
			if (st.state === 'signin') warn.push('Needs a sign-in to show confirmations');
			else if (st.state === 'error') warn.push(st.message ?? 'Confirmations could not be checked');
			if (!accounts.hasPassword(steamId)) warn.push('No saved password');
			const left = accounts.sessionDaysLeft(steamId);
			if (left !== undefined && left <= SESSION_WARN_DAYS) warn.push(`The saved sign-in runs out in ${left} day${left === 1 ? '' : 's'}`);
			const bl = banLabels(avatars.bans(steamId));
			if (bl.length) bad.push(`Steam shows: ${bl.join(', ')}`);
			if (avatars.bans(steamId)?.limited) warn.push('Steam marks this account as limited');
			if (!a.revocationCode) warn.push('No revocation code (you cannot remove the authenticator without it)');
			return { steamId, name: a.accountName, nickname: avatars.nickname(steamId) ?? null, level: bad.length ? 'bad' : warn.length ? 'warn' : 'ok', issues: [...bad, ...warn] };
		});
		return { skew, rows };
	});

	handle('confirmations', (steamId: unknown) => publicStatus(known(steamId)));
	handle('refresh', async (steamId: unknown) => {
		await accounts.refresh(known(steamId));
		return publicStatus(steamId as string);
	});
	handle('act', async (steamId: unknown, action: unknown, ids: unknown) => {
		const id = known(steamId);
		if (action !== 'accept' && action !== 'deny') throw new UserError('Invalid action');
		if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((x) => typeof x === 'string')) {
			throw new UserError('Invalid selection');
		}
		await accounts.act(id, action as Action, ids);
		return publicStatus(id);
	});
	handle('signIn', async (steamId: unknown, password: unknown, save: unknown) => {
		needUnlocked();
		const id = known(steamId);
		await accounts.signIn(id, password === undefined || password === '' ? undefined : str(password, 'password'), save === true);
		return publicStatus(id);
	});
	handle('setPassword', async (steamId: unknown, password: unknown) => {
		needUnlocked();
		return accounts.setPassword(known(steamId), str(password, 'password'));
	});
	handle('clearPassword', (steamId: unknown) => {
		needUnlocked();
		accounts.clearPassword(known(steamId));
	});

	handle('import', async () => {
		const picked = await dialog.showOpenDialog(win!, {
			title: 'Choose maFiles to import',
			properties: ['openFile', 'multiSelections'],
			filters: [{ name: 'maFile', extensions: ['maFile', 'json'] }]
		});
		const results: { file: string; ok: boolean; message: string }[] = [];
		for (const path of picked.filePaths) {
			const file = basename(path);
			if (file.toLowerCase() === 'manifest.json') continue;
			try {
				const m = readMaFile(path);
				const replaced = store.has(m.steamId);
				store.save(m.steamId, m.raw);
				results.push({ file, ok: true, message: replaced ? `Updated ${m.accountName}` : `Added ${m.accountName}` });
			} catch (err) {
				results.push({ file, ok: false, message: err instanceof MaFileError ? err.message : 'Could not read file' });
			}
		}
		accounts.reload();
		return results;
	});
	handle('rescan', () => autoImport());
	handle('addFolder', async () => {
		const picked = await dialog.showOpenDialog(win!, { title: 'Choose a folder with maFiles', properties: ['openDirectory'] });
		const dir = picked.filePaths[0];
		if (!dir) return settings.get();
		const next = settings.update({ importFolders: [...settings.get().importFolders, dir] });
		autoImport();
		return next;
	});
	handle('refreshAll', () => {
		void accounts.refreshAll();
	});
	handle('openSteam', async (steamId: unknown, target: unknown) => {
		const id = known(steamId);
		if (typeof target !== 'string' || !(target in TARGETS)) throw new UserError('Unknown page');
		const token = await accounts.webToken(id);
		openSteamWindow(id, accounts.get(id)!.accountName, token, target);
	});
	// ---- Sending items by trade offer ----
	const gameOf = (key: unknown) => {
		const g = GAMES.find((x) => x.key === key);
		if (!g) throw new UserError('Unknown game');
		return g;
	};
	const cookieOf = async (id: string): Promise<string> => sessionCookie(id, await accounts.webToken(id));
	handle('tradeInventory', async (steamId: unknown, game: unknown) => {
		const id = known(steamId);
		return fetchInventory(fetchHttp, id, gameOf(game), await cookieOf(id));
	});
	handle('tradeResolve', async (account: unknown) => {
		const other = known(account);
		const found = await fetchOwnTradeLink(fetchHttp, other, await cookieOf(other));
		if (!found) throw new UserError(`Could not read the trade link of ${accounts.get(other)!.accountName}. Paste it instead`);
		return `https://steamcommunity.com/tradeoffer/new/?partner=${accountIdOf(found.steamId)}&token=${found.token}`;
	});
	handle('tradeLinks', () => settings.get().tradeLinks);
	handle('tradeLinkSave', (name: unknown, link: unknown) => {
		const l = str(link, 'trade link');
		parseTradeLink(l);
		const rest = settings.get().tradeLinks.filter((x) => x.link !== l.trim());
		return settings.update({ tradeLinks: [...rest, { name: typeof name === 'string' ? name : '', link: l }] }).tradeLinks;
	});
	handle('tradeLinkRemove', (link: unknown) => settings.update({ tradeLinks: settings.get().tradeLinks.filter((x) => x.link !== link) }).tradeLinks);
	handle('tradeSend', async (steamId: unknown, game: unknown, assetIds: unknown, target: unknown) => {
		const id = known(steamId);
		const g = gameOf(game);
		if (!Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > 5000 || !assetIds.every((x) => typeof x === 'string')) throw new UserError('Nothing selected');
		const t = (target ?? {}) as { account?: unknown; link?: unknown };
		let to: TradeLink;
		let toName: string;
		if (typeof t.account === 'string') {
			const other = known(t.account);
			if (other === id) throw new UserError('Choose a different account to receive the items');
			const found = await fetchOwnTradeLink(fetchHttp, other, await cookieOf(other));
			if (!found) throw new UserError(`Could not read the trade link of ${accounts.get(other)!.accountName}. Paste it instead`);
			to = found;
			toName = accounts.get(other)!.accountName;
		} else {
			to = parseTradeLink(str(t.link, 'trade link'));
			if (to.steamId === id) throw new UserError('That trade link belongs to the sending account');
			toName = `…${accountIdOf(to.steamId)}`;
		}
		// Check against Steam's current inventory, never against what the screen believed.
		const inv = await fetchInventory(fetchHttp, id, g, await cookieOf(id));
		const wanted = new Set(assetIds as string[]);
		const chosen = inv.items.filter((i) => wanted.has(i.assetId));
		if (chosen.length !== wanted.size) throw new UserError('The inventory changed. Load it again and choose again');
		const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
		const offers: { offerId: string; items: number; confirmed: boolean; note: string }[] = [];
		let problem = '';
		const name = accounts.get(id)!.accountName;
		const parts = chunk(chosen);
		const summary = (list: typeof chosen): string => {
			const by = new Map<string, number>();
			for (const x of list) by.set(x.name, (by.get(x.name) ?? 0) + x.amount);
			return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c}× ${n}`).join('\n');
		};
		log.info('trade', `${name} → ${toName}: ${g.name}, ${chosen.length} items in ${parts.length} offer${parts.length === 1 ? '' : 's'}`);
		for (const [n, part] of parts.entries()) {
			try {
				if (n > 0) await pause(3000);
				const sent = await sendOffer(fetchHttp, await cookieOf(id), to, g, part);
				log.info('trade', `${name} → ${toName}: offer ${sent.offerId}, ${g.name}, ${part.length} items`, summary(part));
				let confirmed = !sent.needsMobile;
				let note = sent.needsEmail ? 'Steam wants an email confirmation too' : '';
				for (let attempt = 0; sent.needsMobile && !confirmed && attempt < 3; attempt++) {
					await pause(2000);
					const st = await accounts.refresh(id);
					const c = st.items.find((x) => x.creator === sent.offerId);
					if (!c) continue;
					await accounts.act(id, 'accept', [c.id]);
					confirmed = true;
				}
				if (!confirmed) note = 'Sent, but still waiting for your confirmation. Open Confirmations';
				log.info('trade', `${name}: offer ${sent.offerId} ${confirmed ? 'confirmed' : 'sent, not yet confirmed'}`);
				offers.push({ offerId: sent.offerId, items: part.length, confirmed, note });
			} catch (err) {
				problem = err instanceof UserError ? err.message : 'Could not reach Steam';
				log.warn('trade', `${name}: offer ${n + 1} of ${parts.length} failed: ${problem}`);
				break;
			}
		}
		return { offers, planned: parts.length, problem };
	});
	handle('todo', () => {
		const ignored = new Set(settings.get().todoIgnored);
		const items: { kind: string; steamId: string; name: string; detail: string }[] = [];
		for (const steamId of accounts.ids()) {
			const a = accounts.get(steamId)!;
			const st = accounts.status(steamId);
			if (st.state === 'signin' && (accounts.hasPassword(steamId) || ignored.has(`${steamId}:password`))) {
				items.push({ kind: 'signin', steamId, name: a.accountName, detail: st.message ?? 'Needs a sign-in to show confirmations' });
			}
			if (!accounts.hasPassword(steamId) && !ignored.has(`${steamId}:password`)) {
				items.push({ kind: 'password', steamId, name: a.accountName, detail: 'No password saved' });
			}
			const left = accounts.sessionDaysLeft(steamId);
			if (left !== undefined && left <= SESSION_WARN_DAYS && !ignored.has(`${steamId}:expiring`)) {
				items.push({ kind: 'expiring', steamId, name: a.accountName, detail: left === 0 ? 'The saved sign-in runs out today. Save the password to keep it going' : `The saved sign-in runs out in ${left} day${left === 1 ? '' : 's'}. Save the password to keep it going` });
			}
			if (!a.revocationCode && !ignored.has(`${steamId}:revocation`)) {
				items.push({ kind: 'revocation', steamId, name: a.accountName, detail: 'No revocation code. Without it Steam Guard cannot be removed from here' });
			}
		}
		const pendingDir = join(data, 'pending');
		if (existsSync(pendingDir)) {
			for (const f of readdirSync(pendingDir)) {
				if (!/^\d{17}\.maFile$/.test(f)) continue;
				let name = f.slice(0, 17);
				try {
					name = parseMaFile(readFileSync(join(pendingDir, f), 'utf8')).accountName;
				} catch {
					/* keep the id */
				}
				items.push({ kind: 'activation', steamId: f.slice(0, 17), name, detail: 'Authenticator added but never activated' });
			}
		}
		return items;
	});
	handle('todoIgnore', (steamId: unknown, kind: unknown) => {
		const id = str(steamId, 'account');
		if (typeof kind !== 'string' || !/^[a-z]{3,12}$/.test(kind) || !/^\d{17}$/.test(id)) throw new UserError('Invalid item');
		return settings.update({ todoIgnored: [...settings.get().todoIgnored, `${id}:${kind}`] });
	});
	handle('setRevocation', (steamId: unknown, code: unknown) => {
		const id = known(steamId);
		const next = withRevocationCode(store.read(id), str(code, 'code').trim().toUpperCase());
		parseMaFile(next);
		store.save(id, next);
		accounts.reload();
	});

	const exportRows = (ids: unknown): ExportRow[] => {
		if (!Array.isArray(ids) || ids.length > 5000 || !ids.every((x) => typeof x === 'string')) throw new UserError('Invalid selection');
		return ids
			.filter((id: string) => accounts.get(id))
			.map((id: string) => {
				const a = accounts.get(id)!;
				return { username: a.accountName, nickname: avatars.nickname(id), password: credentials.get(id), steamId: a.steamId, sharedSecret: a.sharedSecret, identitySecret: a.identitySecret, revocationCode: a.revocationCode };
			});
	};
	const runExport = (ids: unknown, fields: unknown, delimiter: unknown, skip: unknown) => {
		needUnlocked();
		return buildExport(exportRows(ids), cleanFields(fields), cleanDelimiter(delimiter), skip === true);
	};
	handle('exportInfo', () =>
		accounts.ids().map((steamId) => {
			const a = accounts.get(steamId)!;
			const st = accounts.status(steamId);
			return { steamId, name: a.accountName, nickname: avatars.nickname(steamId) ?? null, addedAt: addedDates.get(steamId, () => store.fileTime(steamId)), pinned: meta.get(steamId).pinned, note: meta.get(steamId).note, tags: meta.get(steamId).tags, pending: st.state === 'ok' ? st.items.length : null, hasPassword: accounts.hasPassword(steamId), hasRevocation: !!a.revocationCode };
		})
	);
	handle('exportCheck', (ids: unknown, fields: unknown, delimiter: unknown, skip: unknown) => {
		const { count, skipped, conflicts } = runExport(ids, fields, delimiter, skip);
		return { count, skipped, conflicts };
	});
	handle('exportCopy', (ids: unknown, fields: unknown, delimiter: unknown, skip: unknown) => {
		const r = runExport(ids, fields, delimiter, skip);
		if (r.count === 0) throw new UserError('Nothing to export');
		copyText(r.text);
		return r.count;
	});
	handle('exportSave', async (ids: unknown, fields: unknown, delimiter: unknown, skip: unknown) => {
		const r = runExport(ids, fields, delimiter, skip);
		if (r.count === 0) throw new UserError('Nothing to export');
		const picked = await dialog.showSaveDialog(win!, { title: 'Save export', defaultPath: 'accounts.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
		if (picked.canceled || !picked.filePath) return null;
		writeFileSync(picked.filePath, r.text, { mode: 0o600 });
		return { count: r.count, path: picked.filePath };
	});
	handle('version', () => app.getVersion());
	const updates = new UpdateChecker(join(data, 'update.json'), app.getVersion());
	/** The notice to show, or nothing: turned off, up to date, not reachable, or dismissed. */
	handle('updateInfo', async (force: unknown) => {
		if (!settings.get().checkUpdates && force !== true) return null;
		const u = await updates.check();
		return u && (force === true || u.version !== settings.get().updateDismissed) ? u : null;
	});
	handle('updateOpen', async () => {
		const u = await updates.check();
		if (u) await shell.openExternal(u.url);
	});
	handle('updateDismiss', (version: unknown) => {
		if (typeof version !== 'string') throw new UserError('Invalid version');
		return settings.update({ updateDismissed: version });
	});
	handle('logList', () => log.list());
	handle('logErrors', (since: unknown) => log.errorsSince(typeof since === 'number' ? since : 0));
	handle('logClear', () => log.clear());
	handle('logCopy', () => copyText(log.text()));
	handle('logClient', (message: unknown) => {
		if (typeof message === 'string') log.error('window', message.slice(0, 1000));
	});
	handle('logSave', async () => {
		const picked = await dialog.showSaveDialog(win!, { title: 'Save log', defaultPath: 'authenticator-log.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
		if (picked.canceled || !picked.filePath) return null;
		writeFileSync(picked.filePath, log.text(), { mode: 0o600 });
		return picked.filePath;
	});
	handle('progress', () => accounts.progress());
	handle('allConfirmations', () =>
		accounts.ids().map((steamId) => ({
			steamId,
			name: accounts.get(steamId)!.accountName,
			nickname: avatars.nickname(steamId) ?? null,
			pinned: meta.get(steamId).pinned,
			...publicStatus(steamId)
		}))
	);
	handle('openProfile', (steamId: unknown) => {
		const id = known(steamId);
		if (!/^\d{17}$/.test(id)) throw new UserError('Invalid account');
		return shell.openExternal(`https://steamcommunity.com/profiles/${id}`);
	});

	handle('enrollState', () => enrollment.current());
	handle('enrollReset', () => enrollment.reset());
	const lineDeps = (): LineImportDeps => ({
		signIn,
		steamNow,
		exists: (id) => store.has(id) || trash.steamIds().has(id),
		save: (id, maFile, password, refresh) => {
			store.save(id, maFile);
			credentials.set(id, password);
			tokens.set(id, refresh);
		}
	});
	const imported = (results: LineResult[]): LineResult[] => {
		accounts.reload();
		win?.webContents.send('changed');
		for (const r of results) if (r.ok) log.info('import', `${r.label}: added from text`);
		return results;
	};
	handle('importLines', async (text: unknown, separator: unknown) => {
		needUnlocked();
		if (typeof text !== 'string' || text.length > 200_000 || typeof separator !== 'string') throw new UserError('Invalid input');
		return imported(await importLines(text, separator, lineDeps()));
	});
	handle('importOne', async (input: unknown) => {
		needUnlocked();
		if (typeof input !== 'object' || input === null) throw new UserError('Invalid input');
		return imported(await importOne(input as Record<string, unknown>, lineDeps()));
	});
	handle('enrollBegin', (name: unknown, password: unknown, save: unknown) => {
		needUnlocked();
		return enrollment.begin(str(name, 'username'), str(password, 'password'), save === true);
	});
	handle('enrollLoginCode', (code: unknown) => enrollment.submitLoginCode(str(code, 'code')));
	handle('enrollAdd', () => enrollment.addAuthenticator());
	handle('enrollActivate', (code: unknown) => enrollment.activate(str(code, 'code')));
	handle('enrollCancel', () => enrollment.cancelPending());
	handle('enrollCopyRevocation', () => {
		const code = enrollment.current().revocationCode;
		if (!code) throw new UserError('No revocation code');
		copyText(code);
	});

	handle('remove', (steamId: unknown) => {
		needUnlocked();
		accounts.remove(known(steamId));
		win?.webContents.send('changed');
	});
	const trashId = (v: unknown): string => {
		const id = str(v, 'entry');
		if (!/^\d{17}\.\d{10,14}$/.test(id)) throw new UserError('Invalid entry');
		return id;
	};
	handle('trashList', () => trash.list());
	handle('trashRestore', (id: unknown) => {
		needUnlocked();
		const steamId = accounts.restore(trashId(id));
		win?.webContents.send('changed');
		void accounts.refresh(steamId);
	});
	handle('trashDelete', (id: unknown) => trash.discard(trashId(id)));
	handle('trashEmpty', () => trash.empty());
	handle('trashOpen', () => {
		mkdirSync(trash.dir, { recursive: true });
		return shell.openPath(trash.dir);
	});

	handle('vaultInfo', () => vaultInfo());
	handle('vaultSetUp', (password: unknown) => {
		if (vault.isSetUp()) throw new UserError('A master password is already set');
		vault.setUp(str(password, 'password'));
		credentials.rewrite();
		tokens.rewrite();
		trash.convert(true);
		log.info('vault', 'Master password turned on');
		return vaultInfo();
	});
	handle('vaultUnlock', (password: unknown) => {
		vault.unlock(str(password, 'password'));
		afterUnlock();
		return vaultInfo();
	});
	handle('vaultUnlockPin', (pin: unknown) => {
		vault.unlockWithKey(devicePin.unlock(str(pin, 'PIN')));
		afterUnlock();
		return vaultInfo();
	});
	handle('vaultLock', () => {
		if (!vault.isSetUp()) throw new UserError('No master password is set');
		vault.lock();
		credentials.reload();
		tokens.reload();
		log.info('vault', 'Locked');
		return vaultInfo();
	});
	handle('vaultChange', (oldPassword: unknown, next: unknown) => {
		needUnlocked();
		vault.changePassword(str(oldPassword, 'password'), str(next, 'new password'));
		return vaultInfo();
	});
	handle('vaultRemove', (password: unknown) => {
		needUnlocked();
		vault.verify(str(password, 'password'));
		// Plain files first, then the key goes: a failure in between loses nothing.
		credentials.rewrite(true);
		tokens.rewrite(true);
		trash.convert(false);
		devicePin.remove();
		vault.remove(str(password, 'password'));
		log.info('vault', 'Master password turned off');
		return vaultInfo();
	});
	handle('pinSet', (pin: unknown) => {
		needUnlocked();
		if (!vault.isSetUp()) throw new UserError('Turn on the master password first');
		const p = str(pin, 'PIN');
		checkPin(p);
		devicePin.set(p, vault.exportKey());
		return vaultInfo();
	});
	handle('pinRemove', () => {
		devicePin.remove();
		return vaultInfo();
	});

	handle('winMinimize', () => win?.minimize());
	handle('winMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
	handle('winClose', () => win?.close());
	handle('winState', () => ({ maximized: win?.isMaximized() ?? false }));
	handle('reveal', () => {
		mkdirSync(store.dir, { recursive: true });
		return shell.openPath(store.dir);
	});

	handle('settings', () => settings.get());
	handle('setSettings', (patch: unknown) => {
		const next = settings.update(patch);
		avatars.recheck();
		schedulePolling();
		watchFolders(externalFolders());
		return next;
	});
}

let pollTimer: NodeJS.Timeout | undefined;
function schedulePolling(): void {
	clearInterval(pollTimer);
	const seconds = settings.get().autoCheckSeconds;
	if (seconds > 0) {
		pollTimer = setInterval(() => void accounts.refreshAll(seconds / 2), seconds * 1000);
		pollTimer.unref();
	}
}

const WINDOW_MIN = { width: 640, height: 520 };
const windowFile = join(data, 'window.json');

function createWindow(): void {
	const state = fitWindowState(loadWindowState(windowFile), screen.getAllDisplays().map((d) => d.workArea), WINDOW_MIN);
	win = new BrowserWindow({
		width: state.width,
		height: state.height,
		...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
		...(existsSync(join(__dirname, 'icon.png')) ? { icon: join(__dirname, 'icon.png') } : {}),
		minWidth: WINDOW_MIN.width,
		minHeight: WINDOW_MIN.height,
		title: 'Authenticator',
		// The window draws its own title bar (see the renderer).
		frame: false,
		show: false,
		backgroundColor: '#0d0e11',
		webPreferences: {
			preload: join(__dirname, 'preload.js'),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	const w = win;
	if (state.maximized) w.maximize();
	// Shown once drawn, so there is no white flash.
	w.once('ready-to-show', () => w.show());
	w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	w.webContents.on('will-navigate', (e) => e.preventDefault());

	const remember = (): void => {
		if (w.isDestroyed() || w.isMinimized()) return;
		const b = w.getNormalBounds();
		saveWindowState(windowFile, { x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() });
	};
	let saveTimer: NodeJS.Timeout | undefined;
	const later = (): void => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(remember, 600);
		saveTimer.unref();
	};
	w.on('resize', later);
	w.on('move', later);
	w.on('close', remember);
	const tell = (): void => w.webContents.send('maximized', w.isMaximized());
	w.on('maximize', tell);
	w.on('unmaximize', tell);
	w.on('closed', () => {
		if (win === w) win = null;
	});
	void w.loadFile(join(__dirname, 'index.html'));
}

app.on('second-instance', () => {
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.focus();
});

app.whenReady().then(async () => {
	if (!firstInstance) return;
	try {
		await startApp();
	} catch (err) {
		log.error('app', 'The program could not start', err);
		dialog.showErrorBox('Authenticator could not start', `${describeWriteError(err) ?? 'Something went wrong while starting.'}\n\nYour accounts and files were not changed.`);
		app.exit(1);
	}
});
async function startApp(): Promise<void> {
	// No menu bar: the window has its own title bar, and Alt must not pop up a stray one.
	Menu.setApplicationMenu(null);
	registerIpc();
	mkdirSync(store.dir, { recursive: true });
	createWindow();
	log.info('app', `Started version ${app.getVersion()}, ${accounts.ids().length} account(s), ${layout.portable ? 'portable' : 'user data'} folder`);
	if (migrated.length) win?.webContents.once('did-finish-load', () => notice('Your earlier data was copied next to the program (maFiles and data folders)'));
	// Pick up anything dropped into the folder while the app was closed, then watch it.
	const dropped = normalizeStoreFolder(store);
	if (dropped.added.length) accounts.reload();
	const imported = autoImport();
	const names = [...dropped.added, ...imported.added];
	if (names.length) win?.webContents.once('did-finish-load', () => notice(`Imported ${names.join(', ')}`));
	schedulePolling();
	startupCheck();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
}
app.on('window-all-closed', () => {
	watcher.close();
	app.quit();
});
