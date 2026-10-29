/** Offset between Steam's clock and ours, so codes and signatures stay valid on a skewed PC. */
let offset = 0;

/** Current time in Unix seconds, corrected to Steam's clock. */
export const steamNow = (): number => Math.floor(Date.now() / 1000) + offset;

/** How far this PC's clock is from Steam's, in seconds (positive: this PC is behind). */
export const clockOffset = (): number => offset;

export async function syncClock(): Promise<void> {
	try {
		const res = await fetch('https://api.steampowered.com/ITwoFactorService/QueryTime/v0001', {
			method: 'POST',
			signal: AbortSignal.timeout(5000)
		});
		const body = (await res.json()) as { response?: { server_time?: string } };
		const server = Number(body.response?.server_time);
		if (Number.isFinite(server) && server > 0) offset = server - Math.floor(Date.now() / 1000);
	} catch {
		/* offline: keep using the local clock */
	}
}
