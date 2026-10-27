import { BrowserWindow, Menu, session, shell } from 'electron';

/**
 * A separate window that is already signed in as one account, for the odd
 * thing that needs the website. Each window gets its own in-memory session, so
 * nothing is shared with other accounts and nothing is kept after closing it.
 */

export const TARGETS: Record<string, string> = {
	profile: 'https://steamcommunity.com/profiles/{id}',
	inventory: 'https://steamcommunity.com/profiles/{id}/inventory/',
	tradeoffers: 'https://steamcommunity.com/profiles/{id}/tradeoffers/',
	market: 'https://steamcommunity.com/market/',
	store: 'https://store.steampowered.com/',
	account: 'https://store.steampowered.com/account/'
};

const HOSTS = /^(?:[a-z0-9-]+\.)*(?:steamcommunity\.com|steampowered\.com|steamstatic\.com|steamcontent\.com|akamaihd\.net|steamusercontent\.com)$/i;
export const isSteamUrl = (raw: string): boolean => {
	try {
		const u = new URL(raw);
		return u.protocol === 'https:' && HOSTS.test(u.hostname);
	} catch {
		return false;
	}
};

const open = new Map<string, BrowserWindow>();

export function openSteamWindow(steamId: string, name: string, accessToken: string, target: string): void {
	const template = TARGETS[target];
	if (!template) throw new Error('Unknown page');
	const url = template.replace('{id}', steamId);

	const existing = open.get(steamId);
	if (existing && !existing.isDestroyed()) {
		void existing.loadURL(url);
		existing.focus();
		return;
	}

	// No "persist:" prefix: cookies live in memory only and die with the window.
	const ses = session.fromPartition(`steam-${steamId}-${Date.now()}`);
	const win = new BrowserWindow({
		width: 1100,
		height: 800,
		title: `${name} on Steam`,
		backgroundColor: '#0d0e11',
		autoHideMenuBar: false,
		webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
	});
	open.set(steamId, win);
	win.on('closed', () => {
		open.delete(steamId);
		void ses.clearStorageData();
	});

	const nav = win.webContents.navigationHistory;
	win.setMenu(
		Menu.buildFromTemplate([
			{ label: 'Back', accelerator: 'Alt+Left', click: () => nav.canGoBack() && nav.goBack() },
			{ label: 'Forward', accelerator: 'Alt+Right', click: () => nav.canGoForward() && nav.goForward() },
			{ label: 'Reload', accelerator: 'F5', click: () => win.webContents.reload() },
			{ label: 'Profile', click: () => void win.loadURL(TARGETS['profile']!.replace('{id}', steamId)) },
			{ label: 'Inventory', click: () => void win.loadURL(TARGETS['inventory']!.replace('{id}', steamId)) },
			{ label: 'Trade offers', click: () => void win.loadURL(TARGETS['tradeoffers']!.replace('{id}', steamId)) },
			{ label: 'Market', click: () => void win.loadURL(TARGETS['market']!) },
			{ label: 'Store', click: () => void win.loadURL(TARGETS['store']!) },
			{ label: 'Open page in default browser', click: () => void shell.openExternal(win.webContents.getURL()) }
		])
	);

	// Stay on Steam. Anything else opens in the normal browser, never in this signed-in window.
	win.webContents.setWindowOpenHandler(({ url: target }) => {
		if (isSteamUrl(target)) void win.loadURL(target);
		else if (/^https:\/\//i.test(target)) void shell.openExternal(target);
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (e, to) => {
		if (!isSteamUrl(to)) {
			e.preventDefault();
			if (/^https:\/\//i.test(to)) void shell.openExternal(to);
		}
	});
	win.webContents.on('page-title-updated', (e) => {
		e.preventDefault();
		win.setTitle(`${name} on Steam - ${win.webContents.getTitle()}`);
	});

	const value = `${steamId}%7C%7C${encodeURIComponent(accessToken)}`;
	const set = (host: string) =>
		ses.cookies.set({ url: `https://${host}/`, name: 'steamLoginSecure', value, secure: true, httpOnly: true, sameSite: 'no_restriction' });
	void Promise.all(['steamcommunity.com', 'store.steampowered.com', 'help.steampowered.com'].map(set)).then(() => win.loadURL(url));
}
