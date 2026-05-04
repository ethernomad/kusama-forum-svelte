import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Helia } from 'helia';

type GlobalHeliaState = typeof globalThis & {
	__kusamaForumHeliaNode?: Helia | null;
	__kusamaForumHeliaNodePromise?: Promise<Helia> | null;
};
import {
	configureIndexerConnectionState,
	ensureStarted as startIndexer,
	indexStatus,
	subscribeIndexerStatus,
	type IndexSpan
} from './indexer.svelte';

const ENDPOINT = 'ws://127.0.0.1:9944';
const INDEXER_ENDPOINT = 'ws://127.0.0.1:8172';

type ConnectionsState = {
	endpoint: string;
	indexerEndpoint: string;
	status: string;
	chainName: string;
	nodeName: string;
	nodeVersion: string;
	latestBlockNumber: string;
	api: ApiPromise | null;
	indexerStatus: string;
	indexerSubscriptionStatus: string;
	indexerSpans: IndexSpan[];
	indexerLatestBlockNumber: string;
	indexerSubscriptionId: string;
	indexerLastUpdate: string;
	ipfsStatus: string;
	ipfsPeerId: string;
	ipfsMultiaddrs: string[];
	ipfsConnections: number;
	heliaNode: Helia | null;
};

export const connections = $state<ConnectionsState>({
	endpoint: ENDPOINT,
	indexerEndpoint: INDEXER_ENDPOINT,
	status: 'Connecting...',
	chainName: '',
	nodeName: '',
	nodeVersion: '',
	latestBlockNumber: '',
	api: null,
	indexerStatus: 'Connecting...',
	indexerSubscriptionStatus: 'Subscribing...',
	indexerSpans: [],
	indexerLatestBlockNumber: '',
	indexerSubscriptionId: '',
	indexerLastUpdate: '',
	ipfsStatus: 'Starting browser IPFS node...',
	ipfsPeerId: '',
	ipfsMultiaddrs: [],
	ipfsConnections: 0,
	heliaNode: null
});

let started = false;
let stopConnections: (() => void) | null = null;

async function getOrCreateHeliaNode(): Promise<Helia> {
	const globalState = globalThis as GlobalHeliaState;
	if (globalState.__kusamaForumHeliaNode) return globalState.__kusamaForumHeliaNode;
	if (globalState.__kusamaForumHeliaNodePromise) return await globalState.__kusamaForumHeliaNodePromise;

	globalState.__kusamaForumHeliaNodePromise = (async () => {
		const { createHelia } = await import('helia');
		const node = await createHelia();
		globalState.__kusamaForumHeliaNode = node;
		return node;
	})();

	try {
		return await globalState.__kusamaForumHeliaNodePromise;
	} finally {
		globalState.__kusamaForumHeliaNodePromise = null;
	}
}

const updateIndexerSpans = (spans: IndexSpan[]) => {
	connections.indexerSpans = spans;
	const latestSpanEnd = spans.reduce<number | null>((latest, span) => {
		if (latest == null || span.end > latest) return span.end;
		return latest;
	}, null);
	connections.indexerLatestBlockNumber = latestSpanEnd == null ? '' : latestSpanEnd.toString();
	connections.indexerLastUpdate = new Date().toLocaleTimeString();
};

export function startAppConnections() {
	if (started) return stopConnections ?? (() => {});
	started = true;

	let active = true;
	let unsubscribeNewHeads: (() => void) | undefined;
	let connectedApi: ApiPromise | null = null;
	let unsubscribeIndexerStatus: (() => void) | undefined;
	let ipfsConnectionInterval: ReturnType<typeof setInterval> | undefined;
	let heliaNode: Helia | null = null;

	void (async () => {
		try {
			const provider = new WsProvider(ENDPOINT);
			connectedApi = await ApiPromise.create({ provider });
			await connectedApi.isReady;

			const [runtimeChain, runtimeNode, runtimeVersion] = await Promise.all([
				connectedApi.rpc.system.chain(),
				connectedApi.rpc.system.name(),
				connectedApi.rpc.system.version()
			]);

			unsubscribeNewHeads = await connectedApi.rpc.chain.subscribeNewHeads((header) => {
				if (!active) return;
				connections.latestBlockNumber = header.number.toString();
			});

			if (!active) {
				unsubscribeNewHeads?.();
				void connectedApi.disconnect();
				return;
			}

			connections.api = connectedApi;
			connections.chainName = runtimeChain.toString();
			connections.nodeName = runtimeNode.toString();
			connections.nodeVersion = runtimeVersion.toString();
			connections.status = 'Connected';
		} catch (error) {
			connections.status = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	})();

	void (() => {
		configureIndexerConnectionState((state) => {
			if (!active) return;
			connections.indexerStatus = state.status;
			connections.indexerSubscriptionStatus = state.subscriptionStatus;
		});
		startIndexer();
		unsubscribeIndexerStatus = subscribeIndexerStatus((spans) => {
			if (!active) return;
			updateIndexerSpans(spans);
			connections.indexerSubscriptionStatus = 'Subscribed to latest blocks';
		});
		void indexStatus()
			.then((spans) => {
				if (!active) return;
				updateIndexerSpans(spans);
			})
			.catch((error) => {
				if (!active) return;
				connections.indexerSubscriptionStatus = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
			});
	})();

	void (async () => {
		try {
			const node = await getOrCreateHeliaNode();
			heliaNode = node;

			if (!active) {
				return;
			}

			connections.heliaNode = node;
			connections.ipfsPeerId = node.libp2p.peerId.toString();
			connections.ipfsMultiaddrs = node.libp2p.getMultiaddrs().map((addr: { toString(): string }) => addr.toString());
			connections.ipfsConnections = node.libp2p.getConnections().length;
			connections.ipfsStatus = 'Running in browser';

			ipfsConnectionInterval = setInterval(() => {
				if (!active) return;
				connections.ipfsConnections = node.libp2p.getConnections().length;
				connections.ipfsMultiaddrs = node.libp2p.getMultiaddrs().map((addr: { toString(): string }) => addr.toString());
			}, 2_000);
		} catch (error) {
			connections.ipfsStatus = `IPFS start failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	})();

	stopConnections = () => {
		active = false;
		unsubscribeNewHeads?.();
		unsubscribeIndexerStatus?.();
		configureIndexerConnectionState(null);
		if (ipfsConnectionInterval) clearInterval(ipfsConnectionInterval);
		void connectedApi?.disconnect();
		started = false;
		stopConnections = null;
	};

	return stopConnections;
}
