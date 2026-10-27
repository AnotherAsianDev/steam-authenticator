// Puts build/icon.ico into a Windows .exe (the small launcher), without needing Windows.
import * as ResEdit from 'resedit';
import { readFileSync, writeFileSync } from 'node:fs';

export async function setExeIcon(exePath, icoPath) {
	const exe = ResEdit.NtExecutable.from(readFileSync(exePath));
	const res = ResEdit.NtExecutableResource.from(exe);
	const ico = ResEdit.Data.IconFile.from(readFileSync(icoPath));
	const entries = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
	const id = entries[0]?.id ?? 1;
	const lang = entries[0]?.lang ?? 1033;
	ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));
	res.outputResource(exe);
	writeFileSync(exePath, Buffer.from(exe.generate()));
}
