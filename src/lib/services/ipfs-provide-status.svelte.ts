type IpfsProvideStatus = {
	pending: number;
	lastCompletedAt: number | null;
	lastError: string | null;
	lastCid: string | null;
};

export const ipfsProvideStatus = $state<IpfsProvideStatus>({
	pending: 0,
	lastCompletedAt: null,
	lastError: null,
	lastCid: null
});

export function beginIpfsProvide(cid: string): void {
	ipfsProvideStatus.pending += 1;
	ipfsProvideStatus.lastCid = cid;
	ipfsProvideStatus.lastError = null;
}

export function completeIpfsProvide(cid: string): void {
	ipfsProvideStatus.pending = Math.max(0, ipfsProvideStatus.pending - 1);
	ipfsProvideStatus.lastCid = cid;
	ipfsProvideStatus.lastCompletedAt = Date.now();
}

export function failIpfsProvide(cid: string, error: unknown): void {
	ipfsProvideStatus.pending = Math.max(0, ipfsProvideStatus.pending - 1);
	ipfsProvideStatus.lastCid = cid;
	ipfsProvideStatus.lastError = error instanceof Error ? error.message : String(error);
}
