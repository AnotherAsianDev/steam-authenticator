import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized: boolean;
}
export interface Area {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_STATE: WindowState = { width: 1040, height: 760, maximized: false };

export function loadWindowState(file: string): WindowState | undefined {
	try {
		if (!existsSync(file)) return undefined;
		const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
		const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
		const width = num(raw['width']);
		const height = num(raw['height']);
		if (!width || !height) return undefined;
		const x = num(raw['x']);
		const y = num(raw['y']);
		return { width, height, maximized: raw['maximized'] === true, ...(x !== undefined && y !== undefined ? { x, y } : {}) };
	} catch {
		return undefined;
	}
}

export function saveWindowState(file: string, s: WindowState): void {
	try {
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, JSON.stringify(s));
		renameSync(tmp, file);
	} catch {
		/* remembering the window is a nicety */
	}
}

/**
 * Make a remembered state safe to use: not smaller than the minimum, not
 * bigger than the biggest screen, and on a screen that still exists (a monitor
 * may have been unplugged since). Otherwise the position is dropped and the
 * system centres the window.
 */
export function fitWindowState(saved: WindowState | undefined, areas: Area[], min: { width: number; height: number }): WindowState {
	const s = saved ?? DEFAULT_STATE;
	const maxW = Math.max(min.width, ...areas.map((a) => a.width));
	const maxH = Math.max(min.height, ...areas.map((a) => a.height));
	const width = Math.min(Math.max(s.width, min.width), maxW);
	const height = Math.min(Math.max(s.height, min.height), maxH);
	const out: WindowState = { width, height, maximized: s.maximized };
	if (s.x !== undefined && s.y !== undefined) {
		const visible = areas.some((a) => {
			const w = Math.min(s.x! + width, a.x + a.width) - Math.max(s.x!, a.x);
			const h = Math.min(s.y! + height, a.y + a.height) - Math.max(s.y!, a.y);
			return w >= 120 && h >= 60;
		});
		if (visible) {
			out.x = s.x;
			out.y = s.y;
		}
	}
	return out;
}
