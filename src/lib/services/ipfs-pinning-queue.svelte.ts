import type { Helia } from 'helia';

export type IpfsPinningQueueEntry = {
	cid: string;
	status: 'queued' | 'sending' | 'acked' | 'failed';
	createdAt: number;
	updatedAt: number;
	attempts: number;
	lastError: string | null;
	ackedAt: number | null;
};

type IpfsPinningQueueState = {
	entries: IpfsPinningQueueEntry[];
	lastProcessedAt: number | null;
};

const STORAGE_KEY = 'kusama-forum.ipfs-pinning-queue';
let hydrated = false;
let flushPromise: Promise<void> | null = null;

export const ipfsPinningQueue = $state<IpfsPinningQueueState>({
	entries: [],
	lastProcessedAt: null
});

function canUseStorage(): boolean {
	return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function persistQueue(): void {
	if (!canUseStorage()) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(ipfsPinningQueue.entries));
}

function hydrateQueue(): void {
	if (hydrated || !canUseStorage()) return;
	hydrated = true;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<IpfsPinningQueueEntry>[];
		if (!Array.isArray(parsed)) return;
		ipfsPinningQueue.entries = parsed
			.filter((entry): entry is Partial<IpfsPinningQueueEntry> & { cid: string } => typeof entry?.cid === 'string' && !!entry.cid)
			.map((entry) => ({
				cid: entry.cid,
				status: entry.status === 'acked' ? 'acked' : entry.status === 'failed' ? 'failed' : 'queued',
				createdAt: Number(entry.createdAt ?? Date.now()),
				updatedAt: Number(entry.updatedAt ?? entry.createdAt ?? Date.now()),
				attempts: Number(entry.attempts ?? 0),
				lastError: entry.lastError == null ? null : String(entry.lastError),
				ackedAt: entry.ackedAt == null ? null : Number(entry.ackedAt)
			}));
	} catch (error) {
		console.warn('Failed to hydrate IPFS pinning queue', error);
	}
}

export function enqueueCidForAck(cid: string): void {
	hydrateQueue();
	const now = Date.now();
	const existing = ipfsPinningQueue.entries.find((entry) => entry.cid === cid);
	if (existing) {
		if (existing.status === 'acked') return;
		existing.status = 'queued';
		existing.updatedAt = now;
		existing.lastError = null;
		persistQueue();
		return;
	}
	ipfsPinningQueue.entries = [
		{
			cid,
			status: 'queued',
			createdAt: now,
			updatedAt: now,
			attempts: 0,
			lastError: null,
			ackedAt: null
		},
		...ipfsPinningQueue.entries
	];
	persistQueue();
}

export async function flushPendingCidAcks(
	heliaNode: Helia | null,
	acknowledgeCid: (heliaNode: Helia, cid: string) => Promise<void>
): Promise<void> {
	hydrateQueue();
	if (!heliaNode || flushPromise) return await (flushPromise ?? Promise.resolve());
	flushPromise = (async () => {
		for (const entry of ipfsPinningQueue.entries) {
			if (entry.status !== 'queued' && entry.status !== 'failed') continue;
			entry.status = 'sending';
			entry.updatedAt = Date.now();
			entry.attempts += 1;
			entry.lastError = null;
			persistQueue();
			try {
				await acknowledgeCid(heliaNode, entry.cid);
				entry.status = 'acked';
				entry.ackedAt = Date.now();
				entry.updatedAt = entry.ackedAt;
			} catch (error) {
				entry.status = 'failed';
				entry.updatedAt = Date.now();
				entry.lastError = error instanceof Error ? error.message : String(error);
			}
			persistQueue();
		}
		ipfsPinningQueue.lastProcessedAt = Date.now();
	})().finally(() => {
		flushPromise = null;
	});
	return await flushPromise;
}

export function retryCidAck(cid: string): void {
	hydrateQueue();
	const entry = ipfsPinningQueue.entries.find((value) => value.cid === cid);
	if (!entry) return;
	entry.status = 'queued';
	entry.updatedAt = Date.now();
	entry.lastError = null;
	persistQueue();
}

export function clearAckedCidEntries(): void {
	hydrateQueue();
	ipfsPinningQueue.entries = ipfsPinningQueue.entries.filter((entry) => entry.status !== 'acked');
	persistQueue();
}

hydrateQueue();
