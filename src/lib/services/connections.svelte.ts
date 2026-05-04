import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Helia } from 'helia';

const ENDPOINT = 'ws://127.0.0.1:9944';
const INDEXER_ENDPOINT = 'ws://127.0.0.1:8172';

type IndexSpan = { start: number; end: number };

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
	let indexerSocket: WebSocket | null = null;
	let indexerRequestId = 0;
	let indexerSubscriptionRequestId: number | null = null;
	let currentIndexerSubscriptionId: string | null = null;
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
		try {
			indexerSocket = new WebSocket(INDEXER_ENDPOINT);

			indexerSocket.addEventListener('open', () => {
				if (!active || indexerSocket == null) return;

				connections.indexerStatus = 'Connected';
				connections.indexerSubscriptionStatus = 'Fetching status...';

				const statusRequestId = ++indexerRequestId;
				indexerSocket.send(
					JSON.stringify({
						jsonrpc: '2.0',
						id: statusRequestId,
						method: 'acuity_indexStatus',
						params: {}
					})
				);

				indexerSubscriptionRequestId = ++indexerRequestId;
				indexerSocket.send(
					JSON.stringify({
						jsonrpc: '2.0',
						id: indexerSubscriptionRequestId,
						method: 'acuity_subscribeStatus',
						params: {}
					})
				);
			});

			indexerSocket.addEventListener('message', (event) => {
				if (!active) return;

				try {
					const message = JSON.parse(event.data as string) as {
						id?: number;
						result?: unknown;
						error?: { message?: string };
						method?: string;
						params?: {
							subscription?: string;
							result?: {
								type?: string;
								spans?: IndexSpan[];
							};
						};
					};

					if (message.error) {
						connections.indexerSubscriptionStatus = `Request failed: ${message.error.message ?? 'Unknown error'}`;
						return;
					}

					if (message.id != null && Array.isArray((message.result as { spans?: IndexSpan[] } | undefined)?.spans)) {
						updateIndexerSpans((message.result as { spans: IndexSpan[] }).spans);
						connections.indexerSubscriptionStatus = currentIndexerSubscriptionId
							? 'Subscribed to latest blocks'
							: 'Waiting for subscription confirmation...';
						return;
					}

					if (message.id != null && message.id === indexerSubscriptionRequestId && typeof message.result === 'string') {
						currentIndexerSubscriptionId = message.result;
						connections.indexerSubscriptionId = message.result;
						connections.indexerSubscriptionStatus = 'Subscribed to latest blocks';
						return;
					}

					if (
						message.method === 'acuity_subscription' &&
						message.params?.result?.type === 'status' &&
						Array.isArray(message.params.result.spans)
					) {
						updateIndexerSpans(message.params.result.spans);
					}
				} catch (error) {
					connections.indexerSubscriptionStatus = `Message parse failed: ${error instanceof Error ? error.message : String(error)}`;
				}
			});

			indexerSocket.addEventListener('close', () => {
				if (!active) return;
				connections.indexerStatus = 'Disconnected';
				connections.indexerSubscriptionStatus = 'Subscription closed';
			});

			indexerSocket.addEventListener('error', () => {
				if (!active) return;
				connections.indexerStatus = `Connection failed: could not connect to ${INDEXER_ENDPOINT}`;
				connections.indexerSubscriptionStatus = 'Unavailable';
			});
		} catch (error) {
			connections.indexerStatus = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
			connections.indexerSubscriptionStatus = 'Unavailable';
		}
	})();

	void (async () => {
		try {
			const { createHelia } = await import('helia');
			const node = await createHelia();
			heliaNode = node;

			if (!active) {
				await node.stop();
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
		if (indexerSocket && currentIndexerSubscriptionId) {
			indexerSocket.send(
				JSON.stringify({
					jsonrpc: '2.0',
					id: ++indexerRequestId,
					method: 'acuity_unsubscribeStatus',
					params: { subscription: currentIndexerSubscriptionId }
				})
			);
		}
		indexerSocket?.close();
		if (ipfsConnectionInterval) clearInterval(ipfsConnectionInterval);
		void connectedApi?.disconnect();
		if (heliaNode) void heliaNode.stop();
		started = false;
		stopConnections = null;
	};

	return stopConnections;
}
