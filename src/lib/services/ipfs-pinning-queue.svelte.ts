export type IpfsPinningQueueEntry = {
	cid: string;
	status: 'sending' | 'acked' | 'failed';
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
				status: entry.status === 'acked' ? 'acked' : entry.status === 'failed' ? 'failed' : 'sending',
				createdAt: Number(entry.createdAt ?? Date.now()),
				updatedAt: Number(entry.updatedAt ?? entry.createdAt ?? Date.now()),
				attempts: Number(entry.attempts ?? 0),
				lastError: entry.lastError == null ? null : String(entry.lastError),
				ackedAt: entry.ackedAt == null ? null : Number(entry.ackedAt)
			}));
	} catch (error) {
		console.warn('Failed to hydrate IPFS pinning history', error);
	}
}

function getOrCreateEntry(cid: string): IpfsPinningQueueEntry {
	const now = Date.now();
	const existing = ipfsPinningQueue.entries.find((entry) => entry.cid === cid);
	if (existing) return existing;

	const entry: IpfsPinningQueueEntry = {
		cid,
		status: 'sending',
		createdAt: now,
		updatedAt: now,
		attempts: 0,
		lastError: null,
		ackedAt: null
	};
	ipfsPinningQueue.entries = [entry, ...ipfsPinningQueue.entries];
	return entry;
}

export function beginCidPinningBatch(cids: string[]): void {
	hydrateQueue();
	const now = Date.now();
	for (const cid of [...new Set(cids.filter(Boolean))]) {
		const entry = getOrCreateEntry(cid);
		entry.status = 'sending';
		entry.updatedAt = now;
		entry.attempts += 1;
		entry.lastError = null;
		entry.ackedAt = null;
	}
	persistQueue();
}

export function markCidPinningSucceeded(cid: string): void {
	hydrateQueue();
	const entry = getOrCreateEntry(cid);
	entry.status = 'acked';
	entry.ackedAt = Date.now();
	entry.updatedAt = entry.ackedAt;
	ipfsPinningQueue.lastProcessedAt = entry.ackedAt;
	persistQueue();
}

export function markCidPinningFailed(cid: string, error: unknown): void {
	hydrateQueue();
	const entry = getOrCreateEntry(cid);
	entry.status = 'failed';
	entry.updatedAt = Date.now();
	entry.lastError = error instanceof Error ? error.message : String(error);
	ipfsPinningQueue.lastProcessedAt = entry.updatedAt;
	persistQueue();
}

export function clearAckedCidEntries(): void {
	hydrateQueue();
	ipfsPinningQueue.entries = ipfsPinningQueue.entries.filter((entry) => entry.status !== 'acked');
	persistQueue();
}

hydrateQueue();
