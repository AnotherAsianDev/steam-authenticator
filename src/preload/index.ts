import { contextBridge, ipcRenderer } from 'electron';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const call = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
	ipcRenderer.invoke(channel, ...args);

const on = (channel: string, cb: (payload: unknown) => void): void => {
	ipcRenderer.on(channel, (_e, payload) => cb(payload));
};

contextBridge.exposeInMainWorld('api', {
	accounts: () => call('accounts'),
	avatar: (id: string) => call('avatar', id),
	copyCode: (id: string) => call('copyCode', id),
	copyField: (id: string, field: string) => call('copyField', id, field),
	detail: (id: string) => call('detail', id),
	confirmations: (id: string) => call('confirmations', id),
	refresh: (id: string) => call('refresh', id),
	act: (id: string, action: 'accept' | 'deny', ids: string[]) => call('act', id, action, ids),
	signIn: (id: string, password: string, save: boolean) => call('signIn', id, password, save),
	setPassword: (id: string, password: string) => call('setPassword', id, password),
	clearPassword: (id: string) => call('clearPassword', id),
	import: () => call('import'),
	rescan: () => call('rescan'),
	addFolder: () => call('addFolder'),
	refreshAll: () => call('refreshAll'),
	openSteam: (id: string, target: string) => call('openSteam', id, target),
	todo: () => call('todo'),
	todoIgnore: (id: string, kind: string) => call('todoIgnore', id, kind),
	setRevocation: (id: string, code: string) => call('setRevocation', id, code),
	exportInfo: () => call('exportInfo'),
	exportCheck: (ids: string[], fields: string[], d: string, skip: boolean) => call('exportCheck', ids, fields, d, skip),
	exportCopy: (ids: string[], fields: string[], d: string, skip: boolean) => call('exportCopy', ids, fields, d, skip),
	exportSave: (ids: string[], fields: string[], d: string, skip: boolean) => call('exportSave', ids, fields, d, skip),
	version: () => call('version'),
	logList: () => call('logList'),
	logClear: () => call('logClear'),
	logCopy: () => call('logCopy'),
	logSave: () => call('logSave'),
	logClient: (m: string) => call('logClient', m),
	onLogChanged: (cb: () => void) => on('logChanged', cb),
	progress: () => call('progress'),
	allConfirmations: () => call('allConfirmations'),
	openProfile: (id: string) => call('openProfile', id),
	enrollState: () => call('enrollState'),
	enrollReset: () => call('enrollReset'),
	enrollBegin: (name: string, password: string, save: boolean) => call('enrollBegin', name, password, save),
	enrollLoginCode: (code: string) => call('enrollLoginCode', code),
	enrollAdd: () => call('enrollAdd'),
	enrollActivate: (code: string) => call('enrollActivate', code),
	enrollCancel: () => call('enrollCancel'),
	enrollCopyRevocation: () => call('enrollCopyRevocation'),
	remove: (id: string) => call('remove', id),
	reveal: () => call('reveal'),
	settings: () => call('settings'),
	setSettings: (patch: unknown) => call('setSettings', patch),
	onChanged: (cb: () => void) => on('changed', cb),
	onNotice: (cb: (n: { message: string; error: boolean }) => void) => on('notice', (p) => cb(p as { message: string; error: boolean }))
});
