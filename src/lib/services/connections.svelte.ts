import { ApiPromise, WsProvider } from '@polkadot/api';

import { ipfsApiUrl, ipfsDaemonId, type IpfsDaemonInfo } from './ipfs';
import {
	configureIndexerConnectionState,
	ensureStarted as startIndexer,
	indexStatus,
	subscribeIndexerStatus,
	type IndexSpan
} from './indexer.svelte';

const ENDPOINT = 'ws://127.0.0.1:9944';
const INDEXER_ENDPOINT = 'ws://127.0.0.1:8172';
const IPFS_STATUS_INTERVAL_MS = 5_000;

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
	ipfsApiUrl: string;
	ipfsPeerId: string;
	ipfsAddresses: string[];
	ipfsProtocols: string[];
	ipfsAgentVersion: string;
	ipfsProtocolVersion: string;
	ipfsPublicKey: string;
	ipfsLastError: string;
	ipfsConnected: boolean;
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
	ipfsStatus: 'Connecting to local IPFS daemon...',
	ipfsApiUrl: ipfsApiUrl(),
	ipfsPeerId: '',
	ipfsAddresses: [],
	ipfsProtocols: [],
	ipfsAgentVersion: '',
	ipfsProtocolVersion: '',
	ipfsPublicKey: '',
	ipfsLastError: '',
	ipfsConnected: false
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

function applyIpfsInfo(info: IpfsDaemonInfo): void {
	connections.ipfsConnected = true;
	connections.ipfsPeerId = info.peerId;
	connections.ipfsAddresses = [...info.addresses];
	connections.ipfsProtocols = [...info.protocols];
	connections.ipfsAgentVersion = info.agentVersion ?? '';
	connections.ipfsProtocolVersion = info.protocolVersion ?? '';
	connections.ipfsPublicKey = info.publicKey ?? '';
	connections.ipfsLastError = '';
	connections.ipfsStatus = 'Connected';
}

function applyIpfsError(error: unknown): void {
	connections.ipfsConnected = false;
	connections.ipfsLastError = error instanceof Error ? error.message : String(error);
	connections.ipfsStatus = `Connection failed: ${connections.ipfsLastError}`;
}

export function startAppConnections() {
	if (started) return stopConnections ?? (() => {});
	started = true;

	let active = true;
	let unsubscribeNewHeads: (() => void) | undefined;
	let connectedApi: ApiPromise | null = null;
	let unsubscribeIndexerStatus: (() => void) | undefined;
	let ipfsInterval: ReturnType<typeof setInterval> | undefined;

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

	const refreshIpfs = async () => {
		if (!active) return;
		try {
			applyIpfsInfo(await ipfsDaemonId());
		} catch (error) {
			if (!active) return;
			applyIpfsError(error);
		}
	};

	void refreshIpfs();
	ipfsInterval = setInterval(() => {
		void refreshIpfs();
	}, IPFS_STATUS_INTERVAL_MS);

	stopConnections = () => {
		active = false;
		unsubscribeNewHeads?.();
		unsubscribeIndexerStatus?.();
		configureIndexerConnectionState(null);
		if (ipfsInterval) clearInterval(ipfsInterval);
		void connectedApi?.disconnect();
		started = false;
		stopConnections = null;
	};

	return stopConnections;
}
