import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Accounts } from './accounts';
import { UserError } from './errors';
import { AvatarCache } from './avatar';
import { findMaFileFolders, importFolder, normalizeStoreFolder } from './autoimport';
import { CredentialStore } from './credentials';
import { FolderWatcher } from './watcher';
import { steamNow, syncClock } from './clock';
import { ConfirmationsClient, fetchTransport, type Action } from './confirmations';
import { MaFileError, parseMaFile } from './mafile';
import { SettingsStore } from './settings';
import { mintAccessToken, signIn, TokenStore } from './sessions';
import { buildExport, cleanDelimiter, cleanFields, withRevocationCode, type ExportRow } from './exporter';
import { migrateLegacy, resolveLayout } from './paths';
import { openSteamWindow, TARGETS } from './browser';
import { StateCache } from './statecache';
import { Enrollment, httpPost, steamLogin } from './enroll';
import { MaFileStore } from './store';
import { generateCode, secondsRemaining } from './totp';

const legacyData = app.getPath('userData');
const layout = resolveLayout(app.isPackaged, process.execPath, legacyData);
if (layout.portable) app.setPath('userData', layout.chromium);
const migrated = migrateLegacy(legacyData, layout);
const data = layout.data;
const store = new MaFileStore(layout.maFiles);
const settings = new SettingsStore(join(data, 'settings.json'));
let win: BrowserWindow | null = null;

const credentials = new CredentialStore(join(data, 'credentials.json'));
const tokens = new TokenStore(join(data, 'sessions.json'));
const avatars = new AvatarCache(join(data, 'avatars'), () => win?.webContents.send('changed'));
const accounts = new Accounts({
	cache: new StateCache(join(data, 'cache.json')),
	store,
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

function handle<T>(channel: string, fn: (...args: any[]) => T | Promise<T>): void {
	ipcMain.handle(channel, async (event, ...args) => {
		// Only our own window may call in.
		if (event.senderFrame?.url !== win?.webContents.getURL()) throw new Error('Untrusted sender');
		try {
			return { ok: true, value: await fn(...args) };
		} catch (err) {
			const message = err instanceof UserError ? err.message : 'Something went wrong';
			return { ok: false, error: message };
		}
	});
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
	for (const f of folders) added.push(...importFolder(f, store).added);
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
	const r = importFolder(dir, store);
	if (r.added.length) {
		accounts.reload();
		win?.webContents.send('changed');
		notice(`Imported ${r.added.join(', ')}`);
	}
}

function registerIpc(): void {
	handle('accounts', () => {
		const t = steamNow();
		const showAvatars = settings.get().showAvatars;
		return accounts.ids().map((steamId) => {
			const a = accounts.get(steamId)!;
			const st = accounts.status(steamId);
			if (showAvatars) avatars.ensure(steamId);
			return {
				steamId,
				name: a.accountName,
				code: generateCode(a.sharedSecret, t),
				remaining: secondsRemaining(t),
				hasAvatar: showAvatars && avatars.has(steamId),
				state: st.state,
				pending: st.state === 'ok' ? st.items.length : null
			};
		});
	});
	handle('avatar', (steamId: unknown) => avatars.get(known(steamId)) ?? null);

	handle('copyCode', (steamId: unknown) => {
		const a = accounts.get(known(steamId))!;
		copyText(generateCode(a.sharedSecret, steamNow()));
	});
	handle('copyField', (steamId: unknown, field: unknown) => {
		const a = accounts.get(known(steamId))!;
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
		return { steamId: a.steamId, name: a.accountName, hasRevocation: !!a.revocationCode, hasPassword: accounts.hasPassword(a.steamId) };
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
		const id = known(steamId);
		await accounts.signIn(id, password === undefined || password === '' ? undefined : str(password, 'password'), save === true);
		return publicStatus(id);
	});
	handle('setPassword', async (steamId: unknown, password: unknown) => {
		return accounts.setPassword(known(steamId), str(password, 'password'));
	});
	handle('clearPassword', (steamId: unknown) => accounts.clearPassword(known(steamId)));

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
				const m = parseMaFile(readFileSync(path, 'utf8'));
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
				return { username: a.accountName, password: credentials.get(id), steamId: a.steamId, sharedSecret: a.sharedSecret, identitySecret: a.identitySecret, revocationCode: a.revocationCode };
			});
	};
	const runExport = (ids: unknown, fields: unknown, delimiter: unknown, skip: unknown) =>
		buildExport(exportRows(ids), cleanFields(fields), cleanDelimiter(delimiter), skip === true);
	handle('exportInfo', () =>
		accounts.ids().map((steamId) => {
			const a = accounts.get(steamId)!;
			return { steamId, name: a.accountName, hasPassword: accounts.hasPassword(steamId), hasRevocation: !!a.revocationCode };
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
	handle('progress', () => accounts.progress());
	handle('allConfirmations', () =>
		accounts.ids().map((steamId) => ({
			steamId,
			name: accounts.get(steamId)!.accountName,
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
	handle('enrollBegin', (name: unknown, password: unknown, save: unknown) =>
		enrollment.begin(str(name, 'username'), str(password, 'password'), save === true)
	);
	handle('enrollLoginCode', (code: unknown) => enrollment.submitLoginCode(str(code, 'code')));
	handle('enrollAdd', () => enrollment.addAuthenticator());
	handle('enrollActivate', (code: unknown) => enrollment.activate(str(code, 'code')));
	handle('enrollCancel', () => enrollment.cancelPending());
	handle('enrollCopyRevocation', () => {
		const code = enrollment.current().revocationCode;
		if (!code) throw new UserError('No revocation code');
		copyText(code);
	});

	handle('remove', (steamId: unknown) => accounts.remove(known(steamId)));
	handle('reveal', () => {
		mkdirSync(store.dir, { recursive: true });
		return shell.openPath(store.dir);
	});

	handle('settings', () => settings.get());
	handle('setSettings', (patch: unknown) => {
		const next = settings.update(patch);
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

function createWindow(): void {
	win = new BrowserWindow({
		width: 1040,
		height: 760,
		minWidth: 640,
		minHeight: 520,
		title: 'Authenticator',
		backgroundColor: '#0d0e11',
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, 'preload.js'),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	win.webContents.on('will-navigate', (e) => e.preventDefault());
	void win.loadFile(join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
	registerIpc();
	mkdirSync(store.dir, { recursive: true });
	createWindow();
	if (migrated.length) win?.webContents.once('did-finish-load', () => notice('Your earlier data was copied next to the program (maFiles and data folders)'));
	await syncClock();
	// Pick up anything dropped into the folder while the app was closed, then watch it.
	const dropped = normalizeStoreFolder(store);
	if (dropped.added.length) accounts.reload();
	const imported = autoImport();
	const names = [...dropped.added, ...imported.added];
	if (names.length) win?.webContents.once('did-finish-load', () => notice(`Imported ${names.join(', ')}`));
	schedulePolling();
	if (settings.get().checkOnStartup) void accounts.refreshAll(600);
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on('window-all-closed', () => {
	watcher.close();
	app.quit();
});
