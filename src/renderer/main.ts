interface Row {
	steamId: string;
	/** Milliseconds since 1970. */
	addedAt: number;
	name: string;
	nickname: string | null;
	code: string;
	remaining: number;
	hasAvatar: boolean;
	state: 'idle' | 'loading' | 'ok' | 'signin' | 'error';
	pending: number | null;
}
interface Item {
	id: string;
	type: number;
	typeName: string;
	headline: string;
	summary: string[];
	created?: number;
	critical: boolean;
}
interface Status {
	state: Row['state'];
	message?: string;
	unreadable: number;
	fetchedAt: number;
	items: Item[];
}
interface Settings {
	theme: 'system' | 'dark' | 'light';
	density: 'comfortable' | 'compact';
	showSteamId: boolean;
	showAvatars: boolean;
	showNickname: boolean;
	autoCheckSeconds: number;
	checkOnStartup: boolean;
	clipboardClearSeconds: number;
	autoDetect: boolean;
	checkUpdates: boolean;
	sortBy: SortBy;
	updateDismissed: string;
	importFolders: string[];
	todoIgnored: string[];
	exportFields: string[];
	exportDelimiter: string;
	exportSkipIncomplete: boolean;
}
interface EnrollState {
	step: 'credentials' | 'loginCode' | 'confirm' | 'activate' | 'done';
	accountName?: string;
	steamId?: string;
	detail?: string;
	phoneHint?: string;
	revocationCode?: string;
	resumed?: boolean;
}
type SortBy = 'added-asc' | 'added-desc' | 'name-asc' | 'name-desc' | 'pending';
interface Sortable {
	steamId: string;
	name: string;
	nickname: string | null;
	addedAt: number;
	pending: number | null;
}
/** The account order chosen in the list, also used for the export. Returns a new array. */
function sortAccounts<T extends Sortable>(rows: T[]): T[] {
	const label = (x: Sortable): string => (settings.showNickname && x.nickname ? x.nickname : x.name).toLowerCase();
	const byName = (a: Sortable, b: Sortable): number => label(a).localeCompare(label(b), undefined, { numeric: true }) || a.steamId.localeCompare(b.steamId);
	const by = settings.sortBy;
	return [...rows].sort((a, b) => {
		if (by === 'added-asc') return a.addedAt - b.addedAt || byName(a, b);
		if (by === 'added-desc') return b.addedAt - a.addedAt || byName(a, b);
		if (by === 'name-asc') return byName(a, b);
		if (by === 'name-desc') return byName(b, a);
		return (b.pending ?? 0) - (a.pending ?? 0) || byName(a, b);
	});
}
const SORTS: [SortBy, string][] = [['added-asc', 'Added: oldest first'], ['added-desc', 'Added: newest first'], ['name-asc', 'Name: A to Z'], ['name-desc', 'Name: Z to A'], ['pending', 'Most pending first']];

interface TodoItem {
	kind: 'signin' | 'password' | 'revocation' | 'activation';
	steamId: string;
	name: string;
	detail: string;
}
interface VaultInfo {
	enabled: boolean;
	locked: boolean;
	pin: boolean;
	pinTries: number;
}
interface TrashEntry {
	id: string;
	steamId: string;
	name: string;
	removedAt: number;
	hasPassword: boolean;
}
interface LogEntry {
	time: number;
	level: 'error' | 'warn' | 'info';
	area: string;
	message: string;
	detail?: string;
	count?: number;
}
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type P<T> = Promise<Result<T>>;
declare const api: {
	accounts(): P<Row[]>;
	avatar(id: string): P<string | null>;
	copyCode(id: string): P<void>;
	copyField(id: string, field: string): P<void>;
	detail(id: string): P<{ steamId: string; name: string; nickname: string | null; hasRevocation: boolean; hasPassword: boolean }>;
	confirmations(id: string): P<Status>;
	refresh(id: string): P<Status>;
	act(id: string, action: 'accept' | 'deny', ids: string[]): P<Status>;
	signIn(id: string, password: string, save: boolean): P<Status>;
	setPassword(id: string, password: string): P<'verified' | 'unverified'>;
	clearPassword(id: string): P<void>;
	import(): P<{ file: string; ok: boolean; message: string }[]>;
	rescan(): P<{ added: string[]; folders: number }>;
	addFolder(): P<Settings>;
	openProfile(id: string): P<void>;
	refreshAll(): P<void>;
	progress(): P<{ running: boolean; done: number; total: number }>;
	openSteam(id: string, target: string): P<void>;
	version(): P<string>;
	updateInfo(force?: boolean): P<{ version: string; url: string } | null>;
	updateOpen(): P<void>;
	updateDismiss(version: string): P<Settings>;
	logList(): P<LogEntry[]>;
	logClear(): P<void>;
	logCopy(): P<void>;
	logSave(): P<string | null>;
	logClient(message: string): P<void>;
	logErrors(since: number): P<number>;
	onLogChanged(cb: () => void): void;
	todo(): P<TodoItem[]>;
	todoIgnore(id: string, kind: string): P<Settings>;
	setRevocation(id: string, code: string): P<void>;
	exportInfo(): P<{ steamId: string; name: string; nickname: string | null; addedAt: number; pending: number | null; hasPassword: boolean; hasRevocation: boolean }[]>;
	exportCheck(ids: string[], fields: string[], d: string, skip: boolean): P<{ count: number; skipped: number; conflicts: number }>;
	exportCopy(ids: string[], fields: string[], d: string, skip: boolean): P<number>;
	exportSave(ids: string[], fields: string[], d: string, skip: boolean): P<{ count: number; path: string } | null>;
	allConfirmations(): P<(Status & { steamId: string; name: string; nickname: string | null })[]>;
	enrollState(): P<EnrollState>;
	enrollReset(): P<EnrollState>;
	importLines(text: string, separator: string): P<{ label: string; ok: boolean; message: string }[]>;
	importOne(input: Record<string, string>): P<{ label: string; ok: boolean; message: string }[]>;
	enrollBegin(name: string, password: string, save: boolean): P<EnrollState>;
	enrollLoginCode(code: string): P<EnrollState>;
	enrollAdd(): P<EnrollState>;
	enrollActivate(code: string): P<EnrollState>;
	enrollCancel(): P<EnrollState>;
	enrollCopyRevocation(): P<void>;
	remove(id: string): P<void>;
	trashList(): P<TrashEntry[]>;
	trashRestore(id: string): P<void>;
	trashDelete(id: string): P<void>;
	trashEmpty(): P<number>;
	trashOpen(): P<string>;
	vaultInfo(): P<VaultInfo>;
	vaultSetUp(password: string): P<VaultInfo>;
	vaultUnlock(password: string): P<VaultInfo>;
	vaultUnlockPin(pin: string): P<VaultInfo>;
	vaultLock(): P<VaultInfo>;
	vaultChange(oldPassword: string, next: string): P<VaultInfo>;
	vaultRemove(password: string): P<VaultInfo>;
	pinSet(pin: string): P<VaultInfo>;
	pinRemove(): P<VaultInfo>;
	winMinimize(): P<void>;
	winMaximize(): P<void>;
	winClose(): P<void>;
	winState(): P<{ maximized: boolean }>;
	onMaximized(cb: (maximized: boolean) => void): void;
	reveal(): P<string>;
	settings(): P<Settings>;
	setSettings(patch: Partial<Settings>): P<Settings>;
	onChanged(cb: () => void): void;
	onNotice(cb: (n: { message: string; error: boolean }) => void): void;
};

const root = document.getElementById('app')!;
let settings: Settings;
let vaultState: VaultInfo = { enabled: false, locked: false, pin: false, pinTries: 0 };
let timer: number | undefined;
let view: { name: 'list' } | { name: 'trash' } | { name: 'log' } | { name: 'todo' } | { name: 'export' } | { name: 'confirms' } | { name: 'add' } | { name: 'settings' } | { name: 'detail'; id: string } = { name: 'list' };
let refreshView: () => void = () => undefined;
const avatarImages = new Map<string, string>();

// ---------------------------------------------------------------- helpers --

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	const { class: cls, ...rest } = props;
	if (cls) node.className = cls;
	Object.assign(node, rest);
	node.append(...children);
	return node;
}

const ICONS: Record<string, string> = {
	codes: '<path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
	confirms: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8.5 9 1.5 1.5L13 7.5M8.5 16l1.5 1.5L13 14.5M15.5 9.5h2M15.5 16.5h2"/>',
	todo: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17"/>',
	export: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
	add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
	settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	log: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
	lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
	trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
	folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
};
const icon = (name: string): HTMLElement =>
	el('span', { class: 'ico', innerHTML: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>` });

/** The app logo (same drawing as build/icon.svg). Gradient ids are unique per instance. */
let logoCount = 0;
const logo = (size: number, bare = false): HTMLElement => {
	const g = `lg${++logoCount}`;
	return el('span', { class: 'logo', innerHTML: `<svg viewBox="${bare ? '100 70 312 372' : '0 0 512 512'}" width="${bare ? Math.round((size * 312) / 372) : size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${g}b" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#232838"/><stop offset="1" stop-color="#0d0e11"/></linearGradient><linearGradient id="${g}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9db2ff"/><stop offset="1" stop-color="#5468e6"/></linearGradient></defs>${bare ? '' : `<rect x="24" y="24" width="464" height="464" rx="118" fill="url(#${g}b)"/><rect x="25.5" y="25.5" width="461" height="461" rx="116.5" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="3"/>`}<path d="M256 82 400 134v118c0 88-60 140-144 176C172 392 112 340 112 252V134z" fill="url(#${g}s)" stroke="#9db2ff" stroke-width="10" stroke-linejoin="round"/><rect x="142" y="196" width="228" height="86" rx="20" fill="#0d0e11" fill-opacity=".38"/><text x="256" y="259" text-anchor="middle" font-family="Consolas, 'DejaVu Sans Mono', monospace" font-weight="700" font-size="64" fill="#fff" textLength="196" lengthAdjust="spacing">GUARD</text></svg>` });
};

const content = el('div', { class: 'content' });
const navButtons = new Map<string, HTMLButtonElement>();
let lockBtn: HTMLButtonElement | undefined;
const WINDOW_GLYPHS = {
	min: '<path d="M1 5.5h8"/>',
	max: '<rect x="1.5" y="1.5" width="7" height="7"/>',
	restore: '<path d="M3 3V1.5h5.5V7H7"/><rect x="1.5" y="3" width="5.5" height="5.5"/>',
	close: '<path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>'
};
const glyph = (g: string): string => `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${g}</svg>`;

/** The window's own title bar: a drag area with minimize, maximize and close. */
function titleBar(): HTMLElement {
	const control = (cls: string, label: string, g: string, run: () => Promise<unknown>): HTMLButtonElement =>
		el('button', { class: `wc ${cls}`, type: 'button', title: label, ariaLabel: label, innerHTML: glyph(g), onclick: () => void run() });
	const max = control('max', 'Maximize', WINDOW_GLYPHS.max, () => api.winMaximize());
	const setMax = (maximized: boolean): void => {
		max.innerHTML = glyph(maximized ? WINDOW_GLYPHS.restore : WINDOW_GLYPHS.max);
		max.title = maximized ? 'Restore' : 'Maximize';
		max.setAttribute('aria-label', max.title);
	};
	api.onMaximized(setMax);
	void api.winState().then((r) => r.ok && setMax(r.value.maximized));
	lockBtn = el('button', { class: 'wc lockbtn', type: 'button', onclick: () => void toggleLock() });
	updateLockNav();
	return el('div', { class: 'titlebar' }, lockBtn, control('min', 'Minimize', WINDOW_GLYPHS.min, () => api.winMinimize()), max, control('close', 'Close', WINDOW_GLYPHS.close, () => api.winClose()));
}

function buildShell(): void {
	const item = (id: string, text: string, go: () => void, count = false): HTMLButtonElement => {
		const b = el('button', { class: 'nav', type: 'button', title: text, onclick: go }, icon(id), el('span', { class: 'label', textContent: text }), ...(count ? [el('span', { class: 'count', textContent: '' })] : []));
		navButtons.set(id, b);
		return b;
	};
	const side = el(
		'aside',
		{ class: 'sidebar' },
		el('div', { class: 'brand' }, logo(40, true), el('span', { class: 'label', textContent: 'Authenticator' })),
		el(
			'nav',
			{ class: 'navlist' },
			item('codes', 'Codes', () => void navigate({ name: 'list' })),
			item('confirms', 'Confirmations', () => void navigate({ name: 'confirms' }), true),
			item('todo', 'To do', () => void navigate({ name: 'todo' }), true),
			item('add', 'Add account', () => void navigate({ name: 'add' })),
			item('export', 'Export', () => void navigate({ name: 'export' }))
		),
		el(
			'nav',
			{ class: 'navlist bottom' },
			item('folder', 'Storage folder', () => void api.reveal()),
			item('trash', 'Trash', () => void navigate({ name: 'trash' })),
			item('log', 'Log', () => void navigate({ name: 'log' }), true),
			item('settings', 'Settings', () => void navigate({ name: 'settings' }))
		)
	);
	root.replaceChildren(el('div', { class: 'shell' }, side, el('div', { class: 'pane' }, titleBar(), content)));
}
function setNav(): void {
	const active = view.name === 'list' || view.name === 'detail' ? 'codes' : view.name;
	navButtons.forEach((b, id) => b.classList.toggle('active', id === active));
	navButtons.get('folder')?.classList.remove('active');
}

/** Runs a screen's refresh on a timer, but not while the window is hidden or minimized. */
function every(ms: number, fn: () => void): void {
	timer = window.setInterval(() => {
		if (!document.hidden) fn();
	}, ms);
}
let onLogChange: () => void = () => undefined;

function show(...nodes: Node[]): void {
	window.clearInterval(timer);
	timer = undefined;
	onLogChange = () => undefined;
	content.replaceChildren(...nodes);
	content.scrollTop = 0;
	setNav();
}

let toastTimer: number | undefined;
function toast(message: string, error = false): void {
	document.querySelector('.toast')?.remove();
	const t = el('div', { class: error ? 'toast error' : 'toast', textContent: message, role: 'status' });
	document.body.append(t);
	window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => t.remove(), 3000);
}

/** A small notice when a newer release exists. Nothing is downloaded; the button opens the release page. */
async function checkForUpdate(force = false): Promise<boolean> {
	if (!force && !settings.checkUpdates) return false;
	const r = await api.updateInfo(force);
	document.querySelector('.update-note')?.remove();
	if (!r.ok || !r.value) return false;
	const u = r.value;
	const note = el('div', { class: 'update-note', role: 'status' },
		el('div', {}, el('strong', { textContent: `Version ${u.version} is available` }), el('p', { class: 'hint fine', textContent: 'Download the new zip from the release page, then drag the new folder over this one and choose Replace.' })),
		el('div', { class: 'row-actions' },
			el('button', { class: 'small', type: 'button', textContent: 'Later', onclick: () => { note.remove(); void api.updateDismiss(u.version).then((s) => { if (s.ok) settings = s.value; }); } }),
			el('button', { class: 'small primary', type: 'button', textContent: 'Open release page', onclick: () => void api.updateOpen() })));
	document.body.append(note);
	return true;
}

function applySettings(s: Settings): void {
	settings = s;
	if (s.theme === 'system') delete document.documentElement.dataset['theme'];
	else document.documentElement.dataset['theme'] = s.theme;
	document.body.classList.toggle('compact', s.density === 'compact');
}

function ago(unix?: number): string {
	if (!unix) return '';
	const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
	if (s < 90) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86400)} d ago`;
}

async function loadAvatar(id: string, into: HTMLElement): Promise<void> {
	let url = avatarImages.get(id);
	if (!url) {
		const r = await api.avatar(id);
		if (r.ok && r.value) {
			url = r.value;
			avatarImages.set(id, url);
		}
	}
	if (url) into.replaceChildren(el('img', { src: url, alt: '' }));
}

/** What to call an account: the Steam profile name if that is turned on and known, else the login name. */
const accountLabel = (name: string, nickname: string | null | undefined): string => (settings.showNickname && nickname ? nickname : name);
/** Second line under a name: the login name when a nickname is shown, then the SteamID64 if wanted. */
function accountSubline(name: string, nickname: string | null | undefined, steamId: string): string {
	const login = settings.showNickname && nickname && nickname !== name ? name : '';
	return [login, settings.showSteamId ? steamId : ''].filter(Boolean).join(' · ');
}

function avatarBox(name: string, id: string, hasAvatar: boolean, size: 'sm' | 'lg'): HTMLElement {
	const box = el('span', { class: `avatar ${size}`, textContent: name.slice(0, 1).toUpperCase() });
	if (hasAvatar && settings.showAvatars) void loadAvatar(id, box);
	return box;
}

function profileLink(id: string, name: string, cls: string): HTMLButtonElement {
	return el('button', {
		class: `${cls} profile-link`,
		type: 'button',
		title: 'Open Steam profile',
		textContent: name,
		onclick: async (e: Event) => {
			e.stopPropagation();
			const r = await api.openProfile(id);
			if (!r.ok) toast(r.error, true);
		}
	});
}

let query = '';
let listFilter: 'all' | 'pending' | 'signin' = 'all';
let confirmType = 'all';
let pendingTotal = 0;
const setTabCount = (): void => {
	const c = navButtons.get('confirms')?.querySelector('.count');
	if (c) c.textContent = pendingTotal ? String(pendingTotal) : '';
};
async function updateLogCount(): Promise<void> {
	const r = await api.logErrors(Number(sessionStorageGet('logSeen') ?? 0));
	const c = navButtons.get('log')?.querySelector('.count');
	if (r.ok && c) c.textContent = r.value ? String(r.value) : '';
}
function sessionStorageGet(k: string): string | null {
	try { return window.sessionStorage.getItem(k); } catch { return null; }
}
function sessionStorageSet(k: string, v: string): void {
	try { window.sessionStorage.setItem(k, v); } catch { /* not available */ }
}
async function updateTodoCount(): Promise<TodoItem[] | undefined> {
	const r = await api.todo();
	const c = navButtons.get('todo')?.querySelector('.count');
	if (r.ok && c) c.textContent = r.value.length ? String(r.value.length) : '';
	return r.ok ? r.value : undefined;
}

/** "Checking 2 of 5" strip, shown only while a round of checks is running. */
function progressStrip(): { node: HTMLElement; update: () => Promise<void> } {
	const label = el('span', { textContent: '' });
	const fill = el('i');
	const node = el('div', { class: 'progress', hidden: true, role: 'status' }, label, el('span', { class: 'track' }, fill));
	return {
		node,
		update: async () => {
			const r = await api.progress();
			if (!r.ok) return;
			const { running, done, total } = r.value;
			node.hidden = !running;
			label.textContent = `Checking confirmations ${Math.min(done + 1, total)} of ${total}`;
			fill.style.width = `${total ? (done / total) * 100 : 0}%`;
		}
	};
}

const goList = (): void => void navigate({ name: 'list' });
async function navigate(v: typeof view): Promise<void> {
	view = v;
	if (v.name === 'list') await listScreen();
	else if (v.name === 'settings') await settingsScreen();
	else if (v.name === 'add') await addScreen();
	else if (v.name === 'confirms') await confirmsScreen();
	else if (v.name === 'todo') await todoScreen();
	else if (v.name === 'log') await logScreen();
	else if (v.name === 'trash') await trashScreen();
	else if (v.name === 'export') await exportScreen();
	else await detailScreen(v.id);
}

/** A button that must be pressed twice within a few seconds. */
function confirmButton(label: string, confirmLabel: string, cls: string, run: () => void): HTMLButtonElement {
	let armed: number | undefined;
	const b = el('button', { class: cls, type: 'button', textContent: label });
	b.addEventListener('click', () => {
		if (armed === undefined) {
			b.textContent = confirmLabel;
			b.classList.add('armed');
			armed = window.setTimeout(() => {
				armed = undefined;
				b.textContent = label;
				b.classList.remove('armed');
			}, 4000);
			return;
		}
		window.clearTimeout(armed);
		armed = undefined;
		b.textContent = label;
		b.classList.remove('armed');
		run();
	});
	return b;
}

const backHeader = (title: string): HTMLElement =>
	el(
		'header',
		{},
		el('div', { class: 'left' }, el('button', { class: 'icon', title: 'Back', ariaLabel: 'Back', textContent: '‹', onclick: goList }), el('span', { class: 'title', textContent: title }))
	);

// --------------------------------------------------------------- lock + PIN --

/** The padlock in the title bar: shown once a master password exists; closed while locked. */
function updateLockNav(): void {
	const b = lockBtn;
	if (!b) return;
	b.hidden = !vaultState.enabled;
	const text = vaultState.locked ? 'Unlock' : 'Lock now';
	b.title = text;
	b.setAttribute('aria-label', text);
	b.classList.toggle('locked', vaultState.locked);
	const shackle = vaultState.locked ? '<path d="M8 11V8a4 4 0 0 1 8 0v3"/>' : '<path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>';
	b.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/>${shackle}</svg>`;
}

async function toggleLock(): Promise<void> {
	if (vaultState.locked) return showLock();
	const r = await api.vaultLock();
	if (!r.ok) return toast(r.error, true);
	vaultState = r.value;
	updateLockNav();
	showLock();
}

/** The unlock screen. It covers the window below the title bar; "Open codes only" dismisses it without unlocking. */
function showLock(): void {
	document.querySelector('.lock')?.remove();
	let usePin = vaultState.pin;
	const card = el('div', { class: 'lock-card' });
	const overlay = el('div', { class: 'lock' }, card);
	document.body.append(overlay);

	function draw(): void {
		const input = el('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: usePin ? 'PIN' : 'Master password', ariaLabel: usePin ? 'PIN' : 'Master password', ...(usePin ? { inputMode: 'numeric' as const } : {}) });
		const err = el('p', { class: 'hint error', textContent: '' });
		const btn = el('button', { class: 'primary', type: 'submit', textContent: 'Unlock' });
		const form = el('form', { class: 'signin' }, input, err, btn);
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			if (!input.value) return;
			btn.disabled = true;
			btn.textContent = 'Unlocking…';
			const r = await (usePin ? api.vaultUnlockPin(input.value) : api.vaultUnlock(input.value));
			if (r.ok) {
				vaultState = r.value;
				updateLockNav();
				overlay.remove();
				refreshView();
				void updateTodoCount();
				toast('Unlocked');
				return;
			}
			input.value = '';
			err.textContent = r.error;
			btn.disabled = false;
			btn.textContent = 'Unlock';
			// Too many wrong PINs removes it: carry on with the password.
			const info = await api.vaultInfo();
			if (info.ok) {
				vaultState = info.value;
				if (usePin && !info.value.pin) {
					usePin = false;
					draw();
					const e2 = card.querySelector<HTMLElement>('.hint.error');
					if (e2) e2.textContent = r.error;
				}
			}
			input.focus();
		});
		card.replaceChildren(
			logo(56),
			el('h1', { textContent: 'Authenticator is locked' }),
			el('p', { class: 'hint', textContent: usePin ? 'Enter your PIN.' : 'Enter your master password to use saved passwords.' }),
			form,
			...(vaultState.pin ? [el('button', { class: 'link', type: 'button', textContent: usePin ? 'Use master password instead' : 'Use PIN instead', onclick: () => { usePin = !usePin; draw(); } })] : []),
			el('button', { class: 'link', type: 'button', textContent: 'Open codes only', onclick: () => overlay.remove() }),
			el('p', { class: 'hint fine', textContent: 'Codes work without unlocking. Saved passwords and automatic sign-in need it.' })
		);
		input.focus();
	}
	draw();
}

interface DialogField {
	name: string;
	label: string;
	numeric?: boolean;
}
/** A small form in a window of its own. `run` returns an error to show, or nothing to close. */
function dialog(title: string, text: string, fields: DialogField[], submit: string, run: (v: Record<string, string>) => Promise<string | undefined>): void {
	document.querySelector('.modal')?.remove();
	const inputs = fields.map((f) => el('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: f.label, ariaLabel: f.label, ...(f.numeric ? { inputMode: 'numeric' as const } : {}) }));
	const err = el('p', { class: 'hint error', textContent: '' });
	const btn = el('button', { class: 'primary', type: 'submit', textContent: submit });
	const close = (): void => {
		overlay.remove();
		document.removeEventListener('keydown', onKey);
	};
	const form = el('form', { class: 'signin' }, el('h1', { textContent: title }), el('p', { class: 'hint', textContent: text }), ...inputs, err, el('div', { class: 'row-actions' }, el('button', { class: 'small', type: 'button', textContent: 'Cancel', onclick: close }), btn));
	const overlay = el('div', { class: 'modal' }, el('div', { class: 'lock-card left' }, form));
	const onKey = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') close();
	};
	document.addEventListener('keydown', onKey);
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		btn.disabled = true;
		const values: Record<string, string> = {};
		fields.forEach((f, i) => (values[f.name] = inputs[i]!.value));
		const problem = await run(values);
		btn.disabled = false;
		if (problem) err.textContent = problem;
		else close();
	});
	document.body.append(overlay);
	inputs[0]?.focus();
}

// ------------------------------------------------------------------- list --

async function listScreen(): Promise<void> {
	const list = el('ul', { class: 'list' });
	const empty = el(
		'div',
		{ class: 'center empty', hidden: true },
		el('h1', { textContent: 'No accounts yet' }),
		el('p', { class: 'hint', textContent: 'Put your maFiles into the storage folder and they show up here by themselves. Folders named maFiles in Downloads, Desktop and Documents are found too.' }),
		el('div', { class: 'row-actions left' }, el('button', { class: 'primary', textContent: 'Open storage folder', onclick: () => void api.reveal() }), el('button', { class: 'small', textContent: 'Import maFiles…', onclick: () => void doImport() }))
	);
	const iconButton = (label: string, text: string, onclick: () => void) =>
		el('button', { class: 'icon', title: label, ariaLabel: label, textContent: text, onclick });
	const header = el(
		'header',
		{},
		el('h1', { class: 'title', textContent: 'Codes' }),
		el('div', { class: 'actions' }, iconButton('Check confirmations now', '↻', () => void api.refreshAll()), )
	);
	const strip = progressStrip();
	const search = el('input', { type: 'text', class: 'search', placeholder: 'Filter accounts', value: query, ariaLabel: 'Filter accounts', spellcheck: false });
	const chipRow = el('div', { class: 'filters' });
	const chipDefs: ['all' | 'pending' | 'signin', string][] = [['all', 'All'], ['pending', 'Pending'], ['signin', 'Sign in']];
	const renderChips = (): void =>
		chipRow.replaceChildren(
			...chipDefs.map(([id, text]) =>
				el('button', { class: `fchip${listFilter === id ? ' on' : ''}`, type: 'button', textContent: text, onclick: () => { listFilter = id; renderChips(); applyFilter(); } })
			)
		);
	renderChips();
	const none = el('p', { class: 'hint center-text', hidden: true, textContent: 'No account matches.' });
	function applyFilter(): void {
		const q = query.trim().toLowerCase();
		let shown = 0;
		list.querySelectorAll<HTMLLIElement>('li').forEach((li) => {
			const matchText = !q || (li.dataset['name'] ?? '').includes(q) || li.dataset['id']!.includes(q);
			const st = li.dataset['state'];
			const matchChip = listFilter === 'all' || (listFilter === 'pending' && Number(li.dataset['pending'] ?? 0) > 0) || (listFilter === 'signin' && st === 'signin');
			li.hidden = !(matchText && matchChip);
			if (!li.hidden) shown++;
		});
		none.hidden = shown > 0 || list.children.length === 0;
	}
	search.addEventListener('input', () => { query = search.value; applyFilter(); });
	let lastRows: Row[] = [];
	const sortSelect = el('select', { class: 'sort', ariaLabel: 'Sort accounts', title: 'Sort accounts' },
		...SORTS.map(([v, text]) => el('option', { value: v, textContent: text, selected: settings.sortBy === v })));
	sortSelect.addEventListener('change', async () => {
		const r = await api.setSettings({ sortBy: sortSelect.value as SortBy });
		if (!r.ok) return toast(r.error, true);
		applySettings(r.value);
		applyOrder(lastRows);
	});
	/** Puts the rows in the chosen order. Only touches the page when the order actually differs, so the list does not flicker. */
	function applyOrder(rows: Row[]): void {
		const sorted = sortAccounts(rows);
		const items = Array.from(list.querySelectorAll<HTMLLIElement>('li'));
		const current = items.map((li) => li.dataset['id']);
		if (current.length === sorted.length && current.every((id, i) => id === sorted[i]!.steamId)) return;
		const byId = new Map(items.map((li) => [li.dataset['id']!, li] as const));
		for (const row of sorted) {
			const li = byId.get(row.steamId);
			if (li) list.append(li);
		}
	}
	const filterBar = el('div', { class: 'filterbar' }, search, el('div', { class: 'filter-line' }, chipRow, sortSelect));
	const overview = el('section', { class: 'overview', hidden: true });
	/** Account count and what is still missing, from the same list as the To do tab (ignored items are not counted). */
	function drawOverview(total: number, todo: TodoItem[] | undefined): void {
		overview.hidden = total === 0 || !todo;
		if (!todo) return;
		const count = (k: TodoItem['kind']): number => todo.filter((t) => t.kind === k).length;
		const defs: [TodoItem['kind'], string][] = [['signin', 'need sign-in'], ['password', 'without password'], ['revocation', 'without revocation code'], ['activation', 'not activated']];
		const chips = defs.filter(([k]) => count(k) > 0).map(([k, text]) => el('button', { class: 'ov-chip warn', type: 'button', title: 'Open the To do list', textContent: `${count(k)} ${text}`, onclick: () => void navigate({ name: 'todo' }) }));
		overview.replaceChildren(
			el('div', { class: 'ov-total' }, el('strong', { textContent: String(total) }), el('span', { textContent: total === 1 ? 'account' : 'accounts' })),
			el('div', { class: 'ov-chips' }, ...(chips.length ? chips : [el('span', { class: 'ov-chip good', textContent: 'Everything is complete' })]))
		);
	}
	show(header, strip.node, el('main', {}, overview, filterBar, list, none, empty));

	async function doImport(): Promise<void> {
		const r = await api.import();
		if (!r.ok) return toast(r.error, true);
		if (r.value.length === 0) return;
		const failed = r.value.filter((x) => !x.ok);
		toast(failed.length ? `${r.value.length - failed.length} imported, ${failed.length} failed: ${failed[0]!.message}` : `${r.value.length} imported`, failed.length > 0);
		await refresh();
	}

	/** `full`: also the progress strip and the to-do count, which only change when something happened. */
	async function refresh(full = true): Promise<void> {
		const r = await api.accounts();
		if (!r.ok) return toast(r.error, true);
		empty.hidden = r.value.length > 0;
		const existing = new Map<string, HTMLLIElement>();
		list.querySelectorAll<HTMLLIElement>('li').forEach((li) => existing.set(li.dataset['id']!, li));

		for (const row of r.value) {
			let li = existing.get(row.steamId);
			if (!li) {
				li = buildRow(row);
				list.append(li);
			}
			existing.delete(row.steamId);
			updateRow(li, row);
		}
		existing.forEach((li) => li.remove());
		lastRows = r.value;
		applyOrder(r.value);
		pendingTotal = r.value.reduce((n, x) => n + (x.pending ?? 0), 0);
		setTabCount();
		filterBar.hidden = r.value.length === 0;
		applyFilter();
		if (full) {
			await strip.update();
			drawOverview(r.value.length, await updateTodoCount());
		}
	}

	function buildRow(row: Row): HTMLLIElement {
		const li = el('li', { class: 'row' });
		li.dataset['id'] = row.steamId;
		const copy = async (): Promise<void> => {
			const c = await api.copyCode(row.steamId);
			toast(c.ok ? 'Code copied' : c.error, !c.ok);
		};
		const badge = el('button', { class: 'badge', type: 'button', hidden: true, onclick: () => void navigate({ name: 'detail', id: row.steamId }) });
		const open = el('button', { class: 'icon more', title: 'Details and confirmations', ariaLabel: `Details for ${row.name}`, textContent: '›', onclick: () => void navigate({ name: 'detail', id: row.steamId }) });
		const code = el('button', { class: 'code', type: 'button', title: 'Click to copy', onclick: () => void copy() });
		li.append(
			el('span', { class: 'avatar-slot' }),
			el('span', { class: 'who' }, profileLink(row.steamId, row.name, 'name'), el('span', { class: 'sid' })),
			badge,
			code,
			open,
			el('span', { class: 'bar' }, el('i'))
		);
		return li;
	}

	function updateRow(li: HTMLLIElement, row: Row): void {
		const slot = li.querySelector<HTMLElement>('.avatar-slot')!;
		const key = `${row.hasAvatar}|${settings.showAvatars}`;
		if (slot.dataset['key'] !== key) {
			slot.dataset['key'] = key;
			slot.replaceChildren(settings.showAvatars ? avatarBox(row.name, row.steamId, row.hasAvatar, 'sm') : '');
			slot.hidden = !settings.showAvatars;
		}
		li.querySelector('.name')!.textContent = accountLabel(row.name, row.nickname);
		li.dataset['name'] = `${row.name} ${row.nickname ?? ''}`.toLowerCase();
		li.dataset['state'] = row.state;
		li.dataset['pending'] = String(row.pending ?? 0);
		const sid = li.querySelector<HTMLElement>('.sid')!;
		const sub = accountSubline(row.name, row.nickname, row.steamId);
		sid.textContent = sub;
		sid.hidden = !sub;
		li.querySelector('.code')!.textContent = row.code;

		const badge = li.querySelector<HTMLButtonElement>('.badge')!;
		badge.className = 'badge';
		badge.hidden = false;
		if (row.state === 'signin') {
			badge.textContent = 'Sign in';
			badge.classList.add('warn');
			badge.title = 'Needed to see confirmations';
		} else if (row.state === 'error') {
			badge.textContent = 'Retry';
			badge.classList.add('warn');
			badge.title = 'Could not check confirmations';
		} else if (row.pending) {
			badge.textContent = `${row.pending} pending`;
			badge.classList.add('hot');
			badge.title = 'Review confirmations';
		} else {
			badge.hidden = true;
		}
		li.querySelector<HTMLElement>('.bar i')!.style.width = `${(row.remaining / 30) * 100}%`;
		li.classList.toggle('expiring', row.remaining <= 5);
	}

	refreshView = () => void refresh();
	await refresh();
	every(1000, () => void refresh(false));
}

// ----------------------------------------------------------- confirmations --

async function confirmsScreen(): Promise<void> {
	const strip = progressStrip();
	const body = el('main', {});
	const header = el(
		'header',
		{},
		el('h1', { class: 'title', textContent: 'Confirmations' }),
		el('div', { class: 'actions' }, el('button', { class: 'icon', title: 'Check all accounts now', ariaLabel: 'Check all accounts now', textContent: '↻', onclick: () => { void api.refreshAll(); } }))
	);
	show(header, strip.node, body);
	let data: (Status & { steamId: string; name: string; nickname: string | null })[] = [];
	const search = el('input', { type: 'text', class: 'search', placeholder: 'Filter by account or text', value: query, ariaLabel: 'Filter confirmations', spellcheck: false });
	const typeSel = el('select', { ariaLabel: 'Type' });
	const list = el('div', { class: 'groups' });
	const last = el('p', { class: 'hint last-checked' });
	body.append(el('div', { class: 'filterbar' }, search, typeSel), last, list);
	search.addEventListener('input', () => { query = search.value; draw(); });
	typeSel.addEventListener('change', () => { confirmType = typeSel.value; draw(); });

	async function act(steamId: string, action: 'accept' | 'deny', id: string): Promise<void> {
		const r = await api.act(steamId, action, [id]);
		toast(r.ok ? (action === 'accept' ? 'Accepted' : 'Denied') : r.error, !r.ok);
		await load();
	}

	function draw(): void {
		const types = [...new Set(data.flatMap((a) => a.items.map((i) => i.typeName)))].sort();
		if (confirmType !== 'all' && !types.includes(confirmType)) confirmType = 'all';
		typeSel.replaceChildren(el('option', { value: 'all', textContent: 'All types' }), ...types.map((t) => el('option', { value: t, textContent: t })));
		typeSel.value = confirmType;
		const q = query.trim().toLowerCase();
		const groups: HTMLElement[] = [];
		let total = 0;
		for (const a of data) {
			const items = a.items.filter((i) => (confirmType === 'all' || i.typeName === confirmType) && (!q || `${a.name} ${a.nickname ?? ''} ${i.headline} ${i.summary.join(' ')}`.toLowerCase().includes(q)));
			const nameMatch = !q || `${a.name} ${a.nickname ?? ''}`.toLowerCase().includes(q);
			const note =
				a.state === 'signin' ? 'Sign in needed' : a.state === 'error' ? (a.message ?? 'Could not check') : a.state === 'loading' || a.state === 'idle' ? 'Checking…' : '';
			if (!items.length && !(note && nameMatch && confirmType === 'all')) continue;
			total += items.length;
			const head = el(
				'div',
				{ class: 'group-head' },
				profileLink(a.steamId, accountLabel(a.name, a.nickname), 'name'),
				note ? el('button', { class: 'badge warn', type: 'button', textContent: note, onclick: () => void navigate({ name: 'detail', id: a.steamId }) }) : el('span', { class: 'hint', textContent: `${items.length}` })
			);
			const ul = el('ul', { class: 'items' }, ...items.map((it) => {
				const actions = it.critical
					? el('div', { class: 'item-actions' }, el('span', { class: 'item-warn', textContent: 'Security critical, review it on the account page' }), el('button', { class: 'small', type: 'button', textContent: 'Open', onclick: () => void navigate({ name: 'detail', id: a.steamId }) }))
					: el('div', { class: 'item-actions' }, confirmButton('Accept', 'Click again to accept', 'small primary', () => void act(a.steamId, 'accept', it.id)), confirmButton('Deny', 'Click again to deny', 'small danger', () => void act(a.steamId, 'deny', it.id)));
				return el(
					'li',
					{ class: `item${it.critical ? ' critical' : ''}` },
					el('div', { class: 'item-body' }, el('span', { class: 'item-meta', textContent: `${it.typeName}${it.created ? ` · ${ago(it.created)}` : ''}` }), el('span', { class: 'item-title', textContent: it.headline || it.typeName }), ...it.summary.map((l) => el('span', { class: 'item-line', textContent: l })), actions)
				);
			}));
			groups.push(el('section', { class: 'group' }, head, ul));
		}
		const times = data.filter((a) => a.fetchedAt > 0 && a.state !== 'signin').map((a) => a.fetchedAt);
		last.textContent = times.length ? `Last checked ${ago(Math.min(...times))}. Press ↻ to check again.` : 'Not checked yet. Press ↻ to check.';
		const running = data.some((a) => a.state === 'loading' || a.state === 'idle');
		list.replaceChildren(...(groups.length ? groups : [el('div', { class: 'center empty-state' }, el('h1', { textContent: running ? 'Checking…' : total === 0 && !q && confirmType === 'all' ? 'Nothing pending' : 'Nothing matches' }), el('p', { class: 'hint', textContent: running ? 'Results appear as each account answers.' : 'Open trade offers and market listings that need your confirmation show up here.' }))]));
	}

	async function load(): Promise<void> {
		const r = await api.allConfirmations();
		if (!r.ok) return toast(r.error, true);
		data = r.value;
		pendingTotal = data.reduce((n, a) => n + (a.state === 'ok' ? a.items.length : 0), 0);
		setTabCount();
		draw();
		await strip.update();
	}
	refreshView = () => void load();
	await load();
	every(30_000, () => void load());
}

// ------------------------------------------------------------------- todo --

async function todoScreen(): Promise<void> {
	const body = el('main', {});
	show(el('header', {}, el('h1', { class: 'title', textContent: 'To do' })), body);

	const SECTIONS: { kind: TodoItem['kind']; title: string; hint: string }[] = [
		{ kind: 'activation', title: 'Finish activation', hint: 'An authenticator was added to Steam but never activated.' },
		{ kind: 'signin', title: 'Sign in', hint: 'A sign-in is needed to see confirmations.' },
		{ kind: 'password', title: 'Save a password', hint: 'Lets the app sign in by itself. Saved in plain text on this computer.' },
		{ kind: 'revocation', title: 'Add the revocation code', hint: 'Needed to remove Steam Guard from an account. It looks like R12345.' }
	];

	async function load(): Promise<void> {
		const r = await api.todo();
		if (!r.ok) return toast(r.error, true);
		const items = r.value;
		void updateTodoCount();
		if (items.length === 0) {
			body.replaceChildren(el('div', { class: 'center empty-state' }, el('h1', { textContent: 'All set' }), el('p', { class: 'hint', textContent: 'Nothing is missing for any account.' })));
			return;
		}
		const ignore = async (it: TodoItem): Promise<void> => {
			const res = await api.todoIgnore(it.steamId, it.kind);
			if (!res.ok) return toast(res.error, true);
			applySettings(res.value);
			await load();
		};
		const sections = SECTIONS.map((sec) => {
			const mine = items.filter((i) => i.kind === sec.kind);
			if (!mine.length) return null;
			const rows = mine.map((it) => {
				const head = el('div', { class: 'todo-head' }, profileLink(it.steamId, it.name, 'name'), el('span', { class: 'hint', textContent: it.detail }));
				let action: HTMLElement;
				if (it.kind === 'password' || it.kind === 'revocation') {
					const isPw = it.kind === 'password';
					const input = el('input', { type: isPw ? 'password' : 'text', placeholder: isPw ? 'Steam password' : 'R12345', autocomplete: 'off', spellcheck: false, ariaLabel: isPw ? `Password for ${it.name}` : `Revocation code for ${it.name}` });
					const form = el('form', { class: 'todo-form' }, input, el('button', { class: 'small primary', type: 'submit', textContent: 'Save' }), el('button', { class: 'link', type: 'button', textContent: 'Not needed', onclick: () => void ignore(it) }));
					form.addEventListener('submit', async (e) => {
						e.preventDefault();
						if (!input.value.trim()) return;
						const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
						btn.disabled = true;
						if (isPw) btn.textContent = 'Checking…';
						const res = isPw ? await api.setPassword(it.steamId, input.value) : await api.setRevocation(it.steamId, input.value);
						btn.disabled = false;
						btn.textContent = 'Save';
						if (!res.ok) return toast(res.error, true);
						toast(!isPw ? 'Revocation code saved' : res.value === 'verified' ? 'Password works and is saved' : 'Saved, but could not check it (no connection)');
						await load();
					});
					action = form;
				} else if (it.kind === 'signin') {
					action = el('div', { class: 'todo-form' }, el('button', { class: 'small primary', type: 'button', textContent: 'Open account', onclick: () => void navigate({ name: 'detail', id: it.steamId }) }));
				} else {
					action = el('div', { class: 'todo-form' }, el('button', { class: 'small primary', type: 'button', textContent: 'Continue', onclick: () => void navigate({ name: 'add' }) }));
				}
				return el('li', { class: 'todo-item' }, head, action);
			});
			return el('section', { class: 'group' }, el('h2', { class: 'todo-title', textContent: `${sec.title} (${mine.length})` }), el('p', { class: 'hint', textContent: sec.hint }), el('ul', { class: 'todo-list' }, ...rows));
		}).filter((x): x is HTMLElement => x !== null);
		body.replaceChildren(el('div', { class: 'groups' }, ...sections));
	}
	refreshView = () => undefined;
	await load();
}

// -------------------------------------------------------------------- log --

async function logScreen(): Promise<void> {
	sessionStorageSet('logSeen', String(Math.floor(Date.now() / 1000)));
	void updateLogCount();
	let entries: LogEntry[] = [];
	let only: 'all' | 'problems' = 'problems';
	let q = '';
	const list = el('div', { class: 'log-list' });
	const search = el('input', { type: 'text', class: 'search', placeholder: 'Filter log', ariaLabel: 'Filter log', spellcheck: false });
	const chips = el('div', { class: 'filters' });
	const header = el(
		'header',
		{},
		el('h1', { class: 'title', textContent: 'Log' }),
		el('div', { class: 'actions' },
			el('button', { class: 'small', type: 'button', textContent: 'Copy all', onclick: async () => { const r = await api.logCopy(); toast(r.ok ? 'Log copied' : r.error, !r.ok); } }),
			el('button', { class: 'small', type: 'button', textContent: 'Save…', onclick: async () => { const r = await api.logSave(); if (!r.ok) toast(r.error, true); else if (r.value) toast('Log saved'); } }),
			confirmButton('Clear', 'Click again', 'small danger', async () => { await api.logClear(); await load(); })
		)
	);
	const body = el('main', {}, el('div', { class: 'filterbar' }, search, chips), el('p', { class: 'hint', textContent: 'Full error details for troubleshooting. Passwords, secrets, tokens and revocation codes are hidden before anything is written here.' }), list);
	show(header, body);
	const time = (t: number): string => new Date(t * 1000).toLocaleString();
	function drawChips(): void {
		chips.replaceChildren(
			...([['problems', 'Warnings and errors'], ['all', 'Everything']] as const).map(([id, text]) =>
				el('button', { class: `fchip${only === id ? ' on' : ''}`, type: 'button', textContent: text, onclick: () => { only = id; drawChips(); draw(); } })
			)
		);
	}
	function draw(): void {
		const needle = q.trim().toLowerCase();
		const shown = entries.filter((e) => (only === 'all' || e.level !== 'info') && (!needle || `${e.area} ${e.message} ${e.detail ?? ''}`.toLowerCase().includes(needle)));
		list.replaceChildren(
			...(shown.length
				? shown.map((e) => {
						const row = el('details', { class: `log-entry ${e.level}` });
						const sum = el('summary', {}, el('span', { class: 'lvl', textContent: e.level }), el('span', { class: 'when', textContent: time(e.time) }), el('span', { class: 'area', textContent: e.area }), el('span', { class: 'msg', textContent: `${e.message}${e.count && e.count > 1 ? `  (x${e.count})` : ''}` }));
						row.append(sum);
						if (e.detail) row.append(el('pre', { class: 'log-detail', textContent: e.detail }));
						else row.classList.add('plain');
						return row;
					})
				: [el('p', { class: 'hint center-text', textContent: only === 'problems' ? 'No warnings or errors.' : 'The log is empty.' })])
		);
	}
	async function load(): Promise<void> {
		const r = await api.logList();
		if (!r.ok) return toast(r.error, true);
		entries = r.value;
		draw();
	}
	search.addEventListener('input', () => { q = search.value; draw(); });
	drawChips();
	refreshView = () => undefined;
	await load();
	onLogChange = () => {
		sessionStorageSet('logSeen', String(Math.floor(Date.now() / 1000)));
		void load();
	};
}

// ------------------------------------------------------------------ trash --

async function trashScreen(): Promise<void> {
	const body = el('main', {});
	const actions = el('div', { class: 'actions' });
	show(el('header', {}, el('h1', { class: 'title', textContent: 'Trash' }), actions), body);

	async function load(): Promise<void> {
		const r = await api.trashList();
		if (!r.ok) return toast(r.error, true);
		const items = r.value;
		actions.replaceChildren(
			el('button', { class: 'small', type: 'button', textContent: 'Open folder', onclick: () => void api.trashOpen() }),
			...(items.length
				? [confirmButton('Empty trash', 'Click again to delete all', 'small danger', async () => {
						const res = await api.trashEmpty();
						toast(res.ok ? `${res.value} deleted for good` : res.error, !res.ok);
						await load();
					})]
				: [])
		);
		const note = el('p', { class: 'hint', textContent: 'Removed accounts are kept here with their saved password until you delete them from this page. They are not imported again from SDA folders on their own.' });
		if (items.length === 0) {
			body.replaceChildren(note, el('div', { class: 'center empty-state' }, el('h1', { textContent: 'Trash is empty' }), el('p', { class: 'hint', textContent: 'When you remove an account it waits here, so it can always be restored.' })));
			return;
		}
		const rows = items.map((it) =>
			el(
				'li',
				{ class: 'trash-row' },
				el('span', { class: 'who' }, el('span', { class: 'name', textContent: it.name }), el('span', { class: 'sid shown', textContent: `Removed ${ago(it.removedAt)}${it.hasPassword ? ' · saved password included' : ''}` })),
				el(
					'span',
					{ class: 'row-actions' },
					el('button', { class: 'small primary', type: 'button', textContent: 'Restore', onclick: async (e: Event) => {
						const b = e.currentTarget as HTMLButtonElement;
						b.disabled = true;
						const res = await api.trashRestore(it.id);
						toast(res.ok ? `${it.name} restored` : res.error, !res.ok);
						await load();
					} }),
					confirmButton('Delete forever', 'Click again to delete', 'small danger', async () => {
						const res = await api.trashDelete(it.id);
						toast(res.ok ? 'Deleted for good' : res.error, !res.ok);
						await load();
					})
				)
			)
		);
		body.replaceChildren(note, el('ul', { class: 'trash-list' }, ...rows));
	}
	refreshView = () => undefined;
	await load();
}

// ----------------------------------------------------------------- export --

const FIELD_INFO: Record<string, { label: string; key: string; example: string }> = {
	username: { label: 'Username', key: 'username', example: 'examplename' },
	nickname: { label: 'Nickname', key: 'nickname', example: 'Olam | CS2' },
	password: { label: 'Password', key: 'password', example: 'hunter2' },
	steamId: { label: 'SteamID64', key: 'steamid64', example: '76561198012345678' },
	sharedSecret: { label: 'shared_secret', key: 'shared_secret', example: 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg=' },
	identitySecret: { label: 'identity_secret', key: 'identity_secret', example: 'cXV4YmF6YmFyZm9vODc2NTQzMjE=' },
	revocationCode: { label: 'Revocation code', key: 'revocation_code', example: 'R12345' }
};
const SEPARATORS: [string, string][] = [[':', ':'], [';', ';'], [',', ','], ['.', '.'], ['|', '|'], ['Tab', '\t'], ['Space', ' ']];

async function exportScreen(): Promise<void> {
	const info = await api.exportInfo();
	if (!info.ok) {
		toast(info.error, true);
		return goList();
	}
	const accountsList = sortAccounts(info.value);
	let order = [...settings.exportFields.filter((f) => f in FIELD_INFO)];
	let on = new Set(order);
	let delimiter = settings.exportDelimiter;
	let skip = settings.exportSkipIncomplete;
	const chosen = new Set(accountsList.map((a) => a.steamId));

	const body = el('main', {});
	show(el('header', {}, el('h1', { class: 'title', textContent: 'Export' })), body);

	const fieldsBox = el('div', { class: 'field-list' });
	const sepBox = el('div', { class: 'filters' });
	const custom = el('input', { type: 'text', class: 'custom-sep', maxLength: 5, placeholder: 'other', ariaLabel: 'Custom separator', spellcheck: false });
	const formatLine = el('code', { class: 'format' });
	const exampleBox = el('pre', { class: 'example' });
	const status = el('p', { class: 'hint' });
	const accBox = el('div', { class: 'acc-list' });
	const copyBtn = el('button', { class: 'primary', type: 'button', textContent: 'Copy' });
	const saveBtn = el('button', { class: 'small', type: 'button', textContent: 'Save as .txt…' });

	const fullOrder = (): string[] => [...order.filter((f) => on.has(f)), ...Object.keys(FIELD_INFO).filter((f) => !on.has(f))];
	const fields = (): string[] => order.filter((f) => on.has(f));
	const ids = (): string[] => accountsList.filter((a) => chosen.has(a.steamId)).map((a) => a.steamId);

	function persist(): void {
		void api.setSettings({ exportFields: fields(), exportDelimiter: delimiter, exportSkipIncomplete: skip }).then((r) => r.ok && applySettings(r.value));
	}

	function drawFields(): void {
		const all = fullOrder();
		fieldsBox.replaceChildren(
			...all.map((f) => {
				const selected = on.has(f);
				const idx = fields().indexOf(f);
				const cb = el('input', { type: 'checkbox', checked: selected, ariaLabel: FIELD_INFO[f]!.label, onchange: () => { if (cb.checked) { on.add(f); order = [...fields().filter((x) => x !== f), f]; } else on.delete(f); drawFields(); update(); } });
				const up = el('button', { class: 'icon', type: 'button', title: 'Move up', ariaLabel: `Move ${FIELD_INFO[f]!.label} up`, textContent: '↑', disabled: !selected || idx <= 0, onclick: () => { const a = fields(); [a[idx - 1], a[idx]] = [a[idx]!, a[idx - 1]!]; order = a; drawFields(); update(); } });
				const down = el('button', { class: 'icon', type: 'button', title: 'Move down', ariaLabel: `Move ${FIELD_INFO[f]!.label} down`, textContent: '↓', disabled: !selected || idx === fields().length - 1, onclick: () => { const a = fields(); [a[idx + 1], a[idx]] = [a[idx]!, a[idx + 1]!]; order = a; drawFields(); update(); } });
				return el('div', { class: `field${selected ? ' on' : ''}` }, el('label', { class: 'check' }, cb, el('span', { class: 'pos', textContent: selected ? String(idx + 1) : '' }), FIELD_INFO[f]!.label), el('span', { class: 'moves' }, up, down));
			})
		);
	}

	function drawSeps(): void {
		const isPreset = SEPARATORS.some(([, v]) => v === delimiter);
		sepBox.replaceChildren(
			...SEPARATORS.map(([label, value]) => el('button', { class: `fchip${delimiter === value ? ' on' : ''}`, type: 'button', textContent: label, onclick: () => { delimiter = value; custom.value = ''; drawSeps(); update(); } })),
			custom
		);
		if (!isPreset) custom.value = delimiter;
	}
	custom.addEventListener('input', () => {
		if (custom.value) {
			delimiter = custom.value;
			drawSeps();
			update();
		}
	});

	const exportSort = el('select', { class: 'sort', ariaLabel: 'Sort accounts', title: 'Sort accounts' },
		...SORTS.map(([v, text]) => el('option', { value: v, textContent: text, selected: settings.sortBy === v })));
	exportSort.addEventListener('change', async () => {
		const r = await api.setSettings({ sortBy: exportSort.value as SortBy });
		if (!r.ok) return toast(r.error, true);
		applySettings(r.value);
		accountsList.splice(0, accountsList.length, ...sortAccounts(accountsList));
		drawAccounts();
		update();
	});

	function drawAccounts(): void {
		accBox.replaceChildren(
			el('div', { class: 'acc-actions' }, el('button', { class: 'link', type: 'button', textContent: 'All', onclick: () => { accountsList.forEach((a) => chosen.add(a.steamId)); drawAccounts(); update(); } }), el('button', { class: 'link', type: 'button', textContent: 'None', onclick: () => { chosen.clear(); drawAccounts(); update(); } })),
			...accountsList.map((a) => {
				const cb = el('input', { type: 'checkbox', checked: chosen.has(a.steamId), onchange: () => { if (cb.checked) chosen.add(a.steamId); else chosen.delete(a.steamId); update(); } });
				const chip = (cls: string, text: string, warn: boolean): HTMLElement => el('span', { class: `chip-s ${cls}${warn ? ' warn' : ''}`, textContent: text });
				return el('label', { class: 'check acc' }, cb,
					el('span', { class: 'acc-main' },
						el('span', { class: 'acc-name', textContent: a.name }),
						el('span', { class: 'acc-sub', textContent: [a.nickname, a.steamId].filter(Boolean).join(' · ') })),
					el('span', { class: 'acc-chips' },
						chip('pw', a.hasPassword ? 'password saved' : 'no password', false),
						chip('rev', a.hasRevocation ? 'revocation code' : 'no revocation code', false)));
			})
		);
	}

	const shown = (v: string): string => v.replace(/\t/g, '⇥').replace(/ /g, '␣');
	let timerId: number | undefined;
	function update(): void {
		const f = fields();
		const names = f.map((x) => FIELD_INFO[x]!.key);
		formatLine.textContent = f.length ? names.join(shown(delimiter)) : '(choose at least one field)';
		const row = (n: number): string => f.map((x) => (x === 'username' || x === 'nickname' ? `${FIELD_INFO[x]!.example}${n}` : x === 'steamId' ? String(BigInt(FIELD_INFO[x]!.example) + BigInt(n - 1)) : FIELD_INFO[x]!.example)).join(delimiter.replace(/\t/g, '\t'));
		exampleBox.textContent = f.length ? [1, 2].map(row).join('\n') : '';
		drawAccountsNotes();
		window.clearTimeout(timerId);
		timerId = window.setTimeout(async () => {
			if (f.length === 0 || ids().length === 0) {
				status.textContent = f.length === 0 ? 'Choose at least one field.' : 'Choose at least one account.';
				status.className = 'hint';
				copyBtn.disabled = saveBtn.disabled = true;
				return;
			}
			const r = await api.exportCheck(ids(), f, delimiter, skip);
			if (!r.ok) {
				status.textContent = r.error;
				status.className = 'hint error';
				copyBtn.disabled = saveBtn.disabled = true;
				return;
			}
			const { count, skipped, conflicts } = r.value;
			const parts = [`${count} line${count === 1 ? '' : 's'} will be written`];
			if (skipped) parts.push(`${skipped} account${skipped === 1 ? '' : 's'} left out (missing value)`);
			status.textContent = parts.join(', ') + '.' + (conflicts ? ` Warning: ${conflicts} value${conflicts === 1 ? ' contains' : 's contain'} this separator, so a line could be read back wrongly. Pick another separator.` : '');
			status.className = conflicts ? 'hint warn' : 'hint';
			copyBtn.disabled = saveBtn.disabled = count === 0;
		}, 80);
		persist();
	}
	/** A missing item is highlighted only when the chosen fields would include it. */
	function drawAccountsNotes(): void {
		accBox.querySelectorAll<HTMLElement>('.acc').forEach((label, i) => {
			const a = accountsList[i]!;
			label.querySelector('.pw')?.classList.toggle('warn', !a.hasPassword && on.has('password'));
			label.querySelector('.rev')?.classList.toggle('warn', !a.hasRevocation && on.has('revocationCode'));
		});
	}

	copyBtn.addEventListener('click', async () => {
		const r = await api.exportCopy(ids(), fields(), delimiter, skip);
		toast(r.ok ? `${r.value} line${r.value === 1 ? '' : 's'} copied` : r.error, !r.ok);
	});
	saveBtn.addEventListener('click', async () => {
		const r = await api.exportSave(ids(), fields(), delimiter, skip);
		if (!r.ok) return toast(r.error, true);
		if (r.value) toast(`Saved ${r.value.count} line${r.value.count === 1 ? '' : 's'}`);
	});
	const skipBox = el('input', { type: 'checkbox', checked: skip, onchange: () => { skip = skipBox.checked; update(); } });

	body.append(
		el(
			'div',
			{ class: 'groups' },
			el('section', { class: 'group' }, el('h2', { class: 'todo-title', textContent: '1. What to include, in which order' }), el('p', { class: 'hint', textContent: 'Tick the fields and use the arrows to set the order.' }), fieldsBox),
			el('section', { class: 'group' }, el('h2', { class: 'todo-title', textContent: '2. Separator' }), el('p', { class: 'hint', textContent: 'Put between the values on each line.' }), sepBox),
			el('section', { class: 'group' }, el('h2', { class: 'todo-title', textContent: '3. Example' }), el('p', { class: 'hint', textContent: 'Made-up data, one line per account:' }), formatLine, exampleBox),
			el('section', { class: 'group' }, el('div', { class: 'group-head' }, el('h2', { class: 'todo-title', textContent: '4. Accounts' }), exportSort), el('p', { class: 'hint', textContent: 'The lines are written in this order. It is the same order as on the Codes page.' }), accBox, el('label', { class: 'check' }, skipBox, 'Leave out accounts that are missing a chosen value')),
			el('section', { class: 'group' }, status, el('div', { class: 'row-actions left' }, copyBtn, saveBtn), el('p', { class: 'hint', textContent: 'The result is plain text with your real passwords and secrets. Keep it safe and delete it when done. Copied text is cleared from the clipboard after the time set in Settings.' }))
		)
	);
	drawFields();
	drawSeps();
	drawAccounts();
	update();
	refreshView = () => undefined;
}

// -------------------------------------------------------------------- add --

async function addScreen(): Promise<void> {
	const body = el('main', {});
	show(backHeader('Add account'), body);
	const run = async (p: P<EnrollState>, after?: (s: EnrollState) => void): Promise<void> => {
		const r = await p;
		if (!r.ok) return toast(r.error, true);
		after?.(r.value);
		draw(r.value);
	};
	const input = (placeholder: string, type = 'text'): HTMLInputElement =>
		el('input', { type, placeholder, autocomplete: 'off', spellcheck: false });
	const submitting = (form: HTMLFormElement, fn: () => Promise<void>): void => {
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
			btn.disabled = true;
			try {
				await fn();
			} finally {
				btn.disabled = false;
			}
		});
	};

	function draw(s: EnrollState): void {
		if (s.step === 'credentials') return drawCredentials();
		if (s.step === 'loginCode') return drawLoginCode(s);
		if (s.step === 'confirm') return drawConfirm(s);
		if (s.step === 'activate') return drawActivate(s);
		return drawDone(s);
	}

	function drawCredentials(): void {
		const user = input('Steam username');
		const pw = input('Password', 'password');
		const save = el('input', { type: 'checkbox', checked: true });
		const form = el(
			'form',
			{ class: 'signin' },
			el('h1', { textContent: 'New authenticator' }),
			el('p', { class: 'hint', textContent: 'For an account that has no Steam Guard Mobile Authenticator yet. Signs in once and creates the maFile for you.' }),
			user,
			pw,
			el('label', { class: 'check' }, save, 'Save the password (plain text, used for automatic sign-in)'),
			el('button', { class: 'primary', type: 'submit', textContent: 'Sign in' })
		);
		submitting(form, async () => {
			await run(api.enrollBegin(user.value, pw.value, save.checked));
		});
		const importCard = el(
			'div',
			{ class: 'card-note' },
			el('span', { class: 'hint', textContent: 'Already have a maFile?' }),
			el('button', { class: 'small', type: 'button', textContent: 'Import maFiles…', onclick: async () => {
				const r = await api.import();
				if (!r.ok) return toast(r.error, true);
				if (r.value.length === 0) return;
				const failed = r.value.filter((x) => !x.ok);
				toast(failed.length ? failed[0]!.message : `${r.value.length} imported`, failed.length > 0);
				if (!failed.length) goList();
			} })
		);
		const linesCard = el(
			'div',
			{ class: 'card-note' },
			el('span', { class: 'hint', textContent: 'Have the password and both secrets?' }),
			el('button', { class: 'small', type: 'button', textContent: 'Import with secrets…', onclick: () => drawLines() })
		);
		body.replaceChildren(form, importCard, linesCard);
		user.focus();
	}

	/** Import from secrets: one account in separate fields, or many as username:password:shared_secret:identity_secret lines. */
	function drawLines(mode: 'one' | 'many' = 'one'): void {
		const out = el('ul', { class: 'import-results' });
		const showResults = (r: { label: string; ok: boolean; message: string }[]): void => {
			out.replaceChildren(...r.map((x) => el('li', { class: x.ok ? 'ok' : 'bad' }, el('strong', { textContent: x.label }), el('span', { class: 'hint', textContent: x.message }))));
			if (r.some((x) => x.ok)) void updateTodoCount();
		};
		const tabs = el('div', { class: 'filters' },
			...(['one', 'many'] as const).map((m) => el('button', { class: `fchip${mode === m ? ' on' : ''}`, type: 'button', textContent: m === 'one' ? 'One account' : 'Several accounts', onclick: () => drawLines(m) })));
		const intro = el('p', { class: 'hint', textContent: 'The app signs in once with the password and a code made from the shared secret, to find the SteamID64. Then it creates the maFile and saves the password for automatic sign-in.' });
		const back = el('button', { class: 'link', type: 'button', textContent: 'Back', onclick: drawCredentials });

		if (mode === 'one') {
			const field = (label: string, hint: string, type = 'text'): { box: HTMLElement; input: HTMLInputElement } => {
				const i = input(label, type);
				i.ariaLabel = label;
				return { box: el('label', { class: 'f' }, el('span', { class: 'f-label', textContent: label }), i, el('span', { class: 'hint fine', textContent: hint })), input: i };
			};
			const u = field('Username', 'The Steam login name');
			const p = field('Password', 'Only used for this sign-in and then saved for automatic sign-in', 'password');
			const ss = field('shared_secret', 'From your maFile or the other authenticator. Looks like Zm9vYmFy…=');
			const ids = field('identity_secret', 'Same place. Used for trade and market confirmations');
			const rv = field('Revocation code (optional)', 'R and 5 digits, like R12345. Only if you still have it; it cannot be recreated');
			const btn = el('button', { class: 'primary', type: 'submit', textContent: 'Import account' });
			const form = el('form', { class: 'signin' }, el('h1', { textContent: 'Import an account' }), intro, tabs, u.box, p.box, ss.box, ids.box, rv.box, btn, out);
			submitting(form, async () => {
				btn.textContent = 'Signing in…';
				const r = await api.importOne({ username: u.input.value, password: p.input.value, sharedSecret: ss.input.value, identitySecret: ids.input.value, revocationCode: rv.input.value });
				btn.textContent = 'Import account';
				if (!r.ok) return toast(r.error, true);
				showResults(r.value);
				if (r.value.every((x) => x.ok)) {
					[u, p, ss, ids, rv].forEach((f) => (f.input.value = ''));
					toast('Account added');
				}
			});
			body.replaceChildren(form, back);
			u.input.focus();
			return;
		}

		const area = el('textarea', { class: 'lines', rows: 6, spellcheck: false, placeholder: 'username:password:shared_secret:identity_secret:R12345 (revocation code optional)', ariaLabel: 'Accounts, one per line' });
		const sepRow = el('div', { class: 'filters' });
		let sep = ':';
		const draws = (): void =>
			sepRow.replaceChildren(...[[':', ':'], [';', ';'], [',', ','], ['|', '|'], ['Tab', '\t']].map(([t, v]) => el('button', { class: `fchip${sep === v ? ' on' : ''}`, type: 'button', textContent: t!, onclick: () => { sep = v!; draws(); } })));
		draws();
		const btn = el('button', { class: 'primary', type: 'submit', textContent: 'Import' });
		const form = el('form', { class: 'signin' }, el('h1', { textContent: 'Import several accounts' }), intro, tabs,
			el('p', { class: 'hint', textContent: 'One account per line: username, password, shared_secret, identity_secret, and optionally the revocation code at the end (R12345). A password may contain the separator.' }),
			area, el('p', { class: 'hint', textContent: 'Separator between the values:' }), sepRow, btn, out);
		submitting(form, async () => {
			btn.textContent = 'Importing… (about 2 seconds per account)';
			const r = await api.importLines(area.value, sep);
			btn.textContent = 'Import';
			if (!r.ok) return toast(r.error, true);
			showResults(r.value);
			if (r.value.some((x) => x.ok)) area.value = '';
		});
		body.replaceChildren(form, back);
		area.focus();
	}

	function drawLoginCode(s: EnrollState): void {
		const code = input('Code from the email', 'text');
		const form = el(
			'form',
			{ class: 'signin' },
			el('h1', { textContent: 'Check your email' }),
			el('p', { class: 'hint', textContent: `Steam sent a sign-in code to your email${s.detail ? ` (${s.detail})` : ''}.` }),
			code,
			el('button', { class: 'primary', type: 'submit', textContent: 'Continue' }),
			el('button', { class: 'link', type: 'button', textContent: 'Start over', onclick: () => void run(api.enrollReset()) })
		);
		submitting(form, async () => {
			await run(api.enrollLoginCode(code.value));
		});
		body.replaceChildren(form);
		code.focus();
	}

	function drawConfirm(s: EnrollState): void {
		body.replaceChildren(
			el(
				'div',
				{ class: 'signin' },
				el('h1', { textContent: `Add Steam Guard to ${s.accountName}?` }),
				el('p', { class: 'hint warn', textContent: 'This changes the account on Steam. A new authenticator is attached and a revocation code is created. Steam only shows it once, so write it down on the next screen.' }),
				el('p', { class: 'hint', textContent: 'Steam then sends an activation code by SMS, or by email if the account has no phone.' }),
				el('button', { class: 'primary', type: 'button', textContent: 'Add authenticator', onclick: (e: Event) => {
					const b = e.currentTarget as HTMLButtonElement;
					b.disabled = true;
					void run(api.enrollAdd()).finally(() => (b.disabled = false));
				} }),
				el('button', { class: 'link', type: 'button', textContent: 'Cancel', onclick: () => void run(api.enrollReset()) })
			)
		);
	}

	function revocationBlock(code: string | undefined): HTMLElement {
		if (!code) return el('p', { class: 'hint error', textContent: 'No revocation code was received.' });
		return el(
			'div',
			{ class: 'revocation' },
			el('span', { class: 'hint', textContent: 'Revocation code, write it down' }),
			el('code', { textContent: code }),
			el('button', { class: 'small', type: 'button', textContent: 'Copy', onclick: async () => {
				const r = await api.enrollCopyRevocation();
				toast(r.ok ? 'Revocation code copied' : r.error, !r.ok);
			} })
		);
	}

	function drawActivate(s: EnrollState): void {
		const code = input('Activation code', 'text');
		const where = s.phoneHint ? `by SMS to ${s.phoneHint}` : 'by SMS or email';
		const form = el(
			'form',
			{ class: 'signin' },
			el('h1', { textContent: 'Activate' }),
			el('p', { class: 'hint', textContent: s.resumed ? 'An earlier attempt for this account was never activated. Enter the newest code Steam sent.' : `The authenticator is saved. Enter the code Steam sent ${where}.` }),
			revocationBlock(s.revocationCode),
			code,
			el('button', { class: 'primary', type: 'submit', textContent: 'Activate' }),
			confirmButton('Cancel and remove it again', 'Click again to remove from Steam', 'link', async () => {
				const r = await api.enrollCancel();
				if (!r.ok) return toast(r.error, true);
				draw(r.value);
				toast('Removed');
			})
		);
		submitting(form, async () => {
			toast('Activating…');
			await run(api.enrollActivate(code.value));
		});
		body.replaceChildren(form);
		code.focus();
	}

	function drawDone(s: EnrollState): void {
		body.replaceChildren(
			el(
				'div',
				{ class: 'signin' },
				el('h1', { textContent: `${s.accountName} is ready` }),
				el('p', { class: 'hint', textContent: 'The maFile is saved in the storage folder and the account appears in the list. Keep the revocation code somewhere safe.' }),
				revocationBlock(s.revocationCode),
				el('button', { class: 'primary', type: 'button', textContent: 'Done', onclick: () => { void api.enrollReset(); goList(); } })
			)
		);
	}

	const cur = await api.enrollState();
	draw(cur.ok ? cur.value : { step: 'credentials' });
}

// ----------------------------------------------------------------- detail --

async function detailScreen(id: string): Promise<void> {
	const d = await api.detail(id);
	if (!d.ok) {
		toast(d.error, true);
		return goList();
	}
	const selected = new Set<string>();
	let lastSig = '';

	const copyBtn = (label: string, field: string): HTMLButtonElement =>
		el('button', {
			class: 'chip',
			type: 'button',
			textContent: label,
			onclick: async () => {
				const r = await api.copyField(id, field);
				toast(r.ok ? `${label} copied` : r.error, !r.ok);
			}
		});

	const chips = el('div', { class: 'chips' }, copyBtn('Username', 'username'), copyBtn('Shared secret', 'sharedSecret'), copyBtn('Identity secret', 'identitySecret'), ...(d.value.hasRevocation ? [copyBtn('Revocation code', 'revocationCode')] : []));
	let hasPassword = d.value.hasPassword;
	let editingPassword = false;
	const pwBlock = el('div', { class: 'pwblock' });
	function renderPw(): void {
		if (editingPassword) {
			const input = el('input', { type: 'password', placeholder: 'Steam password', autocomplete: 'off' });
			const save = el('button', { class: 'small primary', type: 'submit', textContent: 'Save' });
			const cancel = el('button', { class: 'small', type: 'button', textContent: 'Cancel', onclick: () => { editingPassword = false; renderPw(); } });
			const form = el('form', { class: 'pwform' }, input, el('div', { class: 'row-actions left' }, save, cancel), el('p', { class: 'hint', textContent: 'Checked with a real sign-in before it is saved. Kept in plain text on this computer (credentials.json) and used to sign in automatically.' }));
			form.addEventListener('submit', async (e) => {
				e.preventDefault();
				if (!input.value) return;
				save.disabled = true;
				save.textContent = 'Checking…';
				const r = await api.setPassword(id, input.value);
				save.disabled = false;
				save.textContent = 'Save';
				if (!r.ok) return toast(r.error, true);
				hasPassword = true;
				editingPassword = false;
				renderPw();
				toast(r.value === 'verified' ? 'Password works and is saved' : 'Saved, but could not check it (no connection)');
			});
			pwBlock.replaceChildren(form);
			input.focus();
		} else if (hasPassword) {
			pwBlock.replaceChildren(
				el('div', { class: 'chips' }, copyBtn('Password', 'password'), el('button', { class: 'chip', type: 'button', textContent: 'Change', onclick: () => { editingPassword = true; renderPw(); } }), confirmButton('Remove password', 'Click again to remove', 'chip', async () => {
					const r = await api.clearPassword(id);
					if (!r.ok) return toast(r.error, true);
					hasPassword = false;
					renderPw();
					toast('Saved password removed');
				}))
			);
		} else {
			pwBlock.replaceChildren(el('div', { class: 'chips' }, el('button', { class: 'chip', type: 'button', textContent: 'Save password…', onclick: () => { editingPassword = true; renderPw(); } })));
		}
	}
	renderPw();
	const sub = accountSubline(d.value.name, d.value.nickname, d.value.steamId);
	const sidLine = !sub
		? ''
		: settings.showSteamId
			? el('button', { class: 'sidcopy', type: 'button', title: 'Copy SteamID64', textContent: sub, onclick: async () => { await api.copyField(id, 'steamId'); toast('SteamID64 copied'); } })
			: el('span', { class: 'sid shown', textContent: sub });
	const profile = el('div', { class: 'profile' }, avatarBox(d.value.name, id, true, 'lg'), el('div', { class: 'who' }, profileLink(id, accountLabel(d.value.name, d.value.nickname), 'name big'), sidLine));

	const body = el('div', { class: 'conf' });
	const refreshBtn = el('button', { class: 'icon', title: 'Check now', ariaLabel: 'Check for confirmations', textContent: '↻', onclick: async () => {
		refreshBtn.disabled = true;
		const r = await api.refresh(id);
		refreshBtn.disabled = false;
		if (r.ok) render(r.value, true);
		else toast(r.error, true);
	} });

	const removeBtn = confirmButton('Remove account…', 'Click again to remove', 'danger-link', async () => {
		const r = await api.remove(id);
		if (!r.ok) return toast(r.error, true);
		toast('Moved to the trash. You can restore it from Trash');
		goList();
	});

	const webBar = el(
		'div',
		{ class: 'chips' },
		...([['profile', 'Profile'], ['inventory', 'Inventory'], ['tradeoffers', 'Trade offers'], ['market', 'Market'], ['store', 'Store'], ['account', 'Account']] as const).map(([target, label]) =>
			el('button', {
				class: 'chip',
				type: 'button',
				textContent: label,
				onclick: async (e: Event) => {
					const b = e.currentTarget as HTMLButtonElement;
					b.disabled = true;
					const r = await api.openSteam(id, target);
					b.disabled = false;
					if (!r.ok) toast(r.error, true);
				}
			})
		)
	);

	show(
		backHeader('Account'),
		el(
			'main',
			{},
			el(
				'div',
				{ class: 'groups' },
				el('section', { class: 'group profile-card' }, profile),
				el('section', { class: 'group' }, el('h2', { class: 'todo-title', textContent: 'Copy' }), chips, pwBlock),
				el('section', { class: 'group' }, el('h2', { class: 'todo-title', textContent: 'Open on Steam, signed in' }), webBar, el('p', { class: 'hint', textContent: 'Opens a separate window that is already logged in as this account. Nothing is kept when you close it.' })),
				el('section', { class: 'group' }, el('div', { class: 'section-head' }, el('h2', { class: 'todo-title', textContent: 'Confirmations' }), refreshBtn), body),
				el('div', { class: 'danger-zone' }, removeBtn)
			)
		)
	);

	async function act(action: 'accept' | 'deny', ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const r = await api.act(id, action, ids);
		if (!r.ok) {
			toast(r.error, true);
			const cur = await api.confirmations(id);
			if (cur.ok) render(cur.value, true);
			return;
		}
		ids.forEach((x) => selected.delete(x));
		toast(`${ids.length} ${action === 'accept' ? 'accepted' : 'denied'}`);
		render(r.value, true);
	}

	function render(s: Status, force = false): void {
		const sig = JSON.stringify([s.state, s.message, s.unreadable, s.items.map((i) => i.id)]);
		if (!force && sig === lastSig) return;
		lastSig = sig;
		for (const x of [...selected]) if (!s.items.some((i) => i.id === x)) selected.delete(x);

		if (s.state === 'idle' || s.state === 'loading') {
			if (s.items.length === 0) return body.replaceChildren(el('p', { class: 'hint', textContent: 'Checking…' }));
		}
		if (s.state === 'signin') return body.replaceChildren(signInForm(s.message));
		if (s.state === 'error' && s.items.length === 0) {
			return body.replaceChildren(el('p', { class: 'hint error', textContent: s.message ?? 'Could not check confirmations' }), el('button', { class: 'link', textContent: 'Try again', onclick: () => refreshBtn.click() }));
		}

		const parts: Node[] = [];
		if (s.state === 'error') parts.push(el('p', { class: 'hint error', textContent: `${s.message ?? 'Could not refresh'}. Showing the last result.` }));
		if (s.unreadable > 0) parts.push(el('p', { class: 'hint warn', textContent: `${s.unreadable} confirmation${s.unreadable > 1 ? 's' : ''} could not be read. Check them in the Steam app.` }));
		if (s.items.length === 0) {
			parts.push(el('p', { class: 'hint', textContent: s.unreadable ? 'Nothing else pending.' : 'No pending confirmations.' }));
			return body.replaceChildren(...parts);
		}

		const ul = el('ul', { class: 'items' });
		for (const it of s.items) ul.append(itemRow(it));
		parts.push(ul, actionBar(s));
		body.replaceChildren(...parts);
	}

	function itemRow(it: Item): HTMLLIElement {
		const box = el('input', { type: 'checkbox', checked: selected.has(it.id), disabled: it.critical, ariaLabel: `Select ${it.headline || it.typeName}` });
		box.addEventListener('change', () => {
			if (box.checked) selected.add(it.id);
			else selected.delete(it.id);
			updateBar();
		});
		const meta = [it.typeName, ago(it.created)].filter(Boolean).join(' · ');
		const li = el(
			'li',
			{ class: it.critical ? 'item critical' : 'item' },
			el('label', {}, box),
			el(
				'div',
				{ class: 'item-body' },
				el('span', { class: 'item-meta', textContent: meta }),
				el('span', { class: 'item-title', textContent: it.headline || it.typeName }),
				...it.summary.slice(0, 4).map((line) => el('span', { class: 'item-line', textContent: line })),
				...(it.critical
					? [
							el('span', { class: 'item-warn', textContent: 'Security-related. Accept only if you started this yourself.' }),
							el('span', { class: 'item-actions' }, el('button', { class: 'small', textContent: 'Deny', onclick: () => void act('deny', [it.id]) }), confirmButton('Accept', 'Really accept?', 'small danger', () => void act('accept', [it.id])))
						]
					: [])
			)
		);
		return li;
	}

	let barRefs: { acceptSel: HTMLButtonElement; denySel: HTMLButtonElement } | undefined;
	function actionBar(s: Status): HTMLElement {
		const normal = s.items.filter((i) => !i.critical).map((i) => i.id);
		const acceptSel = el('button', { class: 'small primary', type: 'button', onclick: () => void act('accept', [...selected]) });
		const denySel = el('button', { class: 'small', type: 'button', onclick: () => void act('deny', [...selected]) });
		barRefs = { acceptSel, denySel };
		const hasCritical = s.items.length !== normal.length;
		const bar = el(
			'div',
			{ class: 'bar-actions' },
			el('div', { class: 'row-actions' }, denySel, acceptSel),
			el(
				'div',
				{ class: 'row-actions all' },
				normal.length
					? confirmButton(`Deny all (${normal.length})`, `Deny ${normal.length}? Click again`, 'small', () => void act('deny', normal))
					: '',
				normal.length
					? confirmButton(`Accept all (${normal.length})`, `Accept ${normal.length}? Click again`, 'small', () => void act('accept', normal))
					: ''
			),
			hasCritical ? el('p', { class: 'hint', textContent: 'Security-related requests are not included in "all".' }) : ''
		);
		updateBar();
		return bar;
	}
	function updateBar(): void {
		if (!barRefs) return;
		const n = selected.size;
		barRefs.acceptSel.textContent = `Accept selected${n ? ` (${n})` : ''}`;
		barRefs.denySel.textContent = `Deny selected${n ? ` (${n})` : ''}`;
		barRefs.acceptSel.disabled = barRefs.denySel.disabled = n === 0;
	}

	function signInForm(message?: string): HTMLElement {
		const pw = el('input', { type: 'password', placeholder: 'Steam password', autocomplete: 'current-password' });
		const err = el('p', { class: 'hint error', textContent: message ?? '' });
		const saveBox = el('input', { type: 'checkbox', checked: true });
		const saveLabel = el('label', { class: 'check' }, saveBox, hasPassword ? 'Replace the saved password' : 'Save password on this computer');
		const btn = el('button', { class: 'primary', type: 'submit', textContent: 'Sign in' });
		const form = el(
			'form',
			{ class: 'signin' },
			el('p', { class: 'hint', textContent: 'Sign-in is needed once to see confirmations. The Steam Guard code is added automatically.' }),
			pw,
			saveLabel,
			err,
			btn
		);
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			if (!pw.value) return;
			btn.disabled = true;
			btn.textContent = 'Signing in…';
			err.textContent = '';
			const r = await api.signIn(id, pw.value, saveBox.checked);
			pw.value = '';
			btn.disabled = false;
			btn.textContent = 'Sign in';
			if (!r.ok) {
				err.textContent = r.error;
				return;
			}
			if (saveBox.checked) {
				hasPassword = true;
				renderPw();
			}
			render(r.value, true);
		});
		return form;
	}

	refreshView = async () => {
		const r = await api.confirmations(id);
		if (r.ok) render(r.value);
	};
	const first = await api.confirmations(id);
	if (first.ok) {
		render(first.value, true);
	}
	every(15_000, () => void refreshView());
}

// --------------------------------------------------------------- settings --

async function settingsScreen(): Promise<void> {
	const s = settings;
	const set = async (patch: Partial<Settings>): Promise<void> => {
		const r = await api.setSettings(patch);
		if (!r.ok) return toast(r.error, true);
		applySettings(r.value);
		void settingsScreen();
	};

	const row = (label: string, hint: string, control: HTMLElement): HTMLElement =>
		el('div', { class: 'setting' }, el('div', { class: 'setting-text' }, el('span', { class: 'setting-label', textContent: label }), hint ? el('span', { class: 'hint', textContent: hint }) : ''), control);

	const toggle = (value: boolean, on: (v: boolean) => void, label: string): HTMLElement => {
		const b = el('button', { class: 'switch', type: 'button', role: 'switch', ariaChecked: String(value), ariaLabel: label });
		b.addEventListener('click', () => on(!value));
		return b;
	};
	const select = <T extends string | number>(value: T, options: [T, string][], on: (v: T) => void, label: string): HTMLElement => {
		const sel = el('select', { ariaLabel: label });
		for (const [v, text] of options) sel.append(el('option', { value: String(v), textContent: text, selected: v === value }));
		sel.addEventListener('change', () => {
			const picked = options.find(([v]) => String(v) === sel.value);
			if (picked) on(picked[0]);
		});
		return sel;
	};

	const btn = (text: string, run: () => void): HTMLButtonElement => el('button', { class: 'small', type: 'button', textContent: text, onclick: run });
	const apply = (r: Result<VaultInfo>): string | undefined => {
		if (!r.ok) return r.error;
		vaultState = r.value;
		updateLockNav();
		void settingsScreen();
		return undefined;
	};
	const matching = (a: string, b: string): string | undefined => (a === b ? undefined : 'The two entries are different');
	const securityRows = (): HTMLElement[] => {
		if (!vaultState.enabled) {
			return [
				row('Master password', 'Encrypts saved passwords and sign-in tokens (credentials.json, sessions.json). The maFiles stay as they are', btn('Set up…', () =>
					dialog('Set a master password', 'Saved passwords and sign-in tokens are encrypted with it. If you forget it they cannot be recovered and you enter them again; your maFiles are not affected.', [{ name: 'a', label: 'New master password' }, { name: 'b', label: 'Repeat it' }], 'Turn on', async (v) => matching(v['a']!, v['b']!) ?? apply(await api.vaultSetUp(v['a']!)))
				))
			];
		}
		const rows = [
			row('Master password', 'Saved passwords and sign-in tokens are encrypted', el('div', { class: 'row-actions left' },
				btn('Lock now', () => void toggleLock()),
				btn('Change…', () => dialog('Change master password', 'Your saved passwords stay as they are.', [{ name: 'old', label: 'Current master password' }, { name: 'a', label: 'New master password' }, { name: 'b', label: 'Repeat it' }], 'Change', async (v) => matching(v['a']!, v['b']!) ?? apply(await api.vaultChange(v['old']!, v['a']!)))),
				btn('Turn off…', () => dialog('Turn off the master password', 'Saved passwords and sign-in tokens go back to plain text files.', [{ name: 'pw', label: 'Master password' }], 'Turn off', async (v) => apply(await api.vaultRemove(v['pw']!)))))),
			vaultState.pin
				? row('PIN on this PC', 'Unlocks without the master password. Kept on this PC only, not in this folder. 5 wrong tries remove it', el('div', { class: 'row-actions left' },
					btn('Change…', () => dialog('Change PIN', 'Use 6 or more digits.', [{ name: 'a', label: 'New PIN', numeric: true }, { name: 'b', label: 'Repeat it', numeric: true }], 'Save', async (v) => matching(v['a']!, v['b']!) ?? apply(await api.pinSet(v['a']!)))),
					btn('Remove', async () => { const r = apply(await api.pinRemove()); if (r) toast(r, true); })))
				: row('PIN on this PC', 'Unlock with a short PIN instead of the master password. Kept on this PC only, not in this folder', btn('Set PIN…', () =>
					dialog('Set a PIN for this PC', 'Use 6 or more digits. After 5 wrong tries it is removed and the master password is needed again. Any other PC still asks for the master password.', [{ name: 'a', label: 'PIN', numeric: true }, { name: 'b', label: 'Repeat it', numeric: true }], 'Save', async (v) => matching(v['a']!, v['b']!) ?? apply(await api.pinSet(v['a']!)))))
		];
		return rows;
	};

	const folders = el(
		'ul',
		{ class: 'folders' },
		...s.importFolders.map((f) => el('li', {}, el('span', { class: 'path', title: f, textContent: f }), el('button', { class: 'icon', title: 'Remove folder', ariaLabel: `Remove ${f}`, textContent: '✕', onclick: () => void set({ importFolders: s.importFolders.filter((x) => x !== f) }) })))
	);

	show(
		backHeader('Settings'),
		el(
			'main',
			{ class: 'settings' },
			el('h2', { textContent: 'Appearance' }),
			row('Theme', '', select(s.theme, [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], (v) => void set({ theme: v }), 'Theme')),
			row('Density', '', select(s.density, [['comfortable', 'Comfortable'], ['compact', 'Compact']], (v) => void set({ density: v }), 'Density')),
			row('Show Steam nickname', 'Instead of the login name, which then appears under it. Taken from the public profile', toggle(s.showNickname, (v) => void set({ showNickname: v }), 'Show Steam nickname')),
			row('Show SteamID64', 'Under each account name', toggle(s.showSteamId, (v) => void set({ showSteamId: v }), 'Show SteamID64')),
			row('Show profile pictures', 'Fetched from the public profile, at most once a week per account', toggle(s.showAvatars, (v) => void set({ showAvatars: v }), 'Show profile pictures')),
			el('h2', { textContent: 'Confirmations' }),
			row('Check when the app starts', 'One round, one account at a time', toggle(s.checkOnStartup, (v) => void set({ checkOnStartup: v }), 'Check when the app starts')),
			row('Check repeatedly', 'Off is safest. Steam rate-limits frequent checks', select(s.autoCheckSeconds, [[0, 'Never, only with the button'], [300, 'Every 5 minutes'], [900, 'Every 15 minutes'], [1800, 'Every 30 minutes']], (v) => void set({ autoCheckSeconds: v }), 'Check interval')),
			el('h2', { textContent: 'Clipboard' }),
			row('Clear after copying', 'Codes and secrets', select(s.clipboardClearSeconds, [[0, 'Never'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute']], (v) => void set({ clipboardClearSeconds: v }), 'Clear clipboard')),
			el('h2', { textContent: 'Security' }),
			...securityRows(),
			el('h2', { textContent: 'Importing' }),
			row('Check for updates', 'Asks GitHub each time the app starts if a newer release exists and tells you. Nothing is downloaded or installed', el('div', { class: 'row-actions left' },
				el('button', { class: 'small', type: 'button', textContent: 'Check now', onclick: async () => { const found = await checkForUpdate(true); if (!found) toast('You have the latest version'); } }),
				toggle(s.checkUpdates, (v) => void set({ checkUpdates: v }), 'Check for updates')),),
			row('Find SDA folders automatically', 'Looks for folders named maFiles in Downloads, Desktop and Documents when the app starts', toggle(s.autoDetect, (v) => void set({ autoDetect: v }), 'Find SDA folders automatically')),
			el('div', { class: 'setting stack' }, el('span', { class: 'setting-label', textContent: 'Watched folders' }), s.importFolders.length ? folders : el('span', { class: 'hint', textContent: 'None added.' }), el('div', { class: 'row-actions left' }, el('button', { class: 'small', textContent: 'Add folder…', onclick: async () => { const r = await api.addFolder(); if (r.ok) { applySettings(r.value); void settingsScreen(); } else toast(r.error, true); } }), el('button', { class: 'small', textContent: 'Scan now', onclick: async () => { const r = await api.rescan(); if (!r.ok) return toast(r.error, true); toast(r.value.added.length ? `Imported ${r.value.added.join(', ')}` : 'Nothing new found'); } }))),
			el('p', { class: 'hint fine', id: 'ver' }),
			el('p', { class: 'hint fine', textContent: 'New accounts are copied; existing ones are never overwritten and your originals are never changed. Passwords you choose to save, and the sign-in token, are kept next to your maFiles (credentials.json and sessions.json), in plain text unless you set a master password under Security.' }),
			el('div', { class: 'about' }, logo(44), el('div', {}, el('strong', { textContent: 'Authenticator' }), el('p', { class: 'hint', textContent: '© 2026 github.com/AnotherAsianDev. MIT License.' }), el('p', { class: 'hint fine', textContent: 'Not affiliated with or endorsed by Valve. Steam is a trademark of Valve Corporation.' })))
		)
	);
	void api.version().then((v) => { const n = document.getElementById('ver'); if (n && v.ok) n.textContent = `Version ${v.value}. To update, drop the new folder over this one and choose Replace. Your maFiles and data stay.`; });
	refreshView = () => undefined;
}

// ------------------------------------------------------------------- boot --

async function boot(): Promise<void> {
	const s = await api.settings();
	if (s.ok) applySettings(s.value);
	else applySettings({ theme: 'system', density: 'comfortable', showSteamId: false, showAvatars: true, showNickname: false, autoCheckSeconds: 0, checkOnStartup: true, clipboardClearSeconds: 30, autoDetect: true, importFolders: [], todoIgnored: [], exportFields: ['username', 'password', 'sharedSecret', 'identitySecret'], exportDelimiter: ':', exportSkipIncomplete: false, checkUpdates: true, sortBy: 'added-asc', updateDismissed: '' });
	api.onChanged(() => refreshView());
	api.onLogChanged(() => {
		void updateLogCount();
		onLogChange();
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) refreshView();
	});
	document.addEventListener('keydown', (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
			const box = document.querySelector<HTMLInputElement>('.search');
			if (box) {
				e.preventDefault();
				box.focus();
				box.select();
			}
		}
	});
	window.addEventListener('error', (e) => void api.logClient(`${e.message} (${e.filename}:${e.lineno})`));
	window.addEventListener('unhandledrejection', (e) => void api.logClient(`Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`));
	api.onNotice((n) => {
		toast(n.message, n.error);
		refreshView();
	});
	const v = await api.vaultInfo();
	if (v.ok) vaultState = v.value;
	buildShell();
	void checkForUpdate();
	updateLockNav();
	if (vaultState.locked) showLock();
	void updateLogCount();
	await listScreen();
}

void boot();
