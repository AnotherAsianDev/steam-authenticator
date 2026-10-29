import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from './atomic';

export interface AccountMetaEntry {
	pinned: boolean;
	note: string;
	tags: string[];
}
export const NOTE_MAX = 120;
export const TAG_MAX = 20;
export const TAGS_MAX = 1;

/** Tags from a list or a comma separated text: trimmed, no # or control characters, unique, limited in length and number. */
export function cleanTags(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
	const out: string[] = [];
	for (const t of raw) {
		if (typeof t !== 'string') continue;
		// eslint-disable-next-line no-control-regex
		const tag = t.replace(/[\u0000-\u001f\u007f#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX);
		if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
	}
	return out.slice(0, TAGS_MAX);
}

/** Cleans a note: no control characters, trimmed, one line, limited length. */
export function cleanNote(value: unknown): string {
	if (typeof value !== 'string') return '';
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
}

/**
 * Per-account extras that belong to this program, not to the maFile: a pin and a short note.
 * Kept in their own file so the maFiles stay exactly as Steam Desktop Authenticator wrote them.
 */
export class AccountMeta {
	private data = new Map<string, AccountMetaEntry>();

	constructor(private readonly file: string) {
		for (const path of [file, `${file}.bak`]) {
			try {
				if (!existsSync(path)) continue;
				const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
				for (const [id, v] of Object.entries(raw)) {
					if (!/^\d{17}$/.test(id) || typeof v !== 'object' || v === null) continue;
					const o = v as Record<string, unknown>;
					const entry = { pinned: o['pinned'] === true, note: cleanNote(o['note']), tags: cleanTags(o['tags']) };
					if (entry.pinned || entry.note || entry.tags.length) this.data.set(id, entry);
				}
				return;
			} catch {
				/* try the earlier copy */
			}
		}
	}

	get(steamId: string): AccountMetaEntry {
		return this.data.get(steamId) ?? { pinned: false, note: '', tags: [] };
	}

	set(steamId: string, patch: { pinned?: unknown; note?: unknown; tags?: unknown }): AccountMetaEntry {
		const cur = this.get(steamId);
		const next = {
			pinned: typeof patch.pinned === 'boolean' ? patch.pinned : cur.pinned,
			note: patch.note !== undefined ? cleanNote(patch.note) : cur.note,
			tags: patch.tags !== undefined ? cleanTags(patch.tags) : cur.tags
		};
		if (next.pinned || next.note || next.tags.length) this.data.set(steamId, next);
		else this.data.delete(steamId);
		this.save();
		return next;
	}

	private save(): void {
		writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(this.data)), { backup: true });
	}
}
