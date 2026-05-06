import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { ping } from '@libp2p/ping';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { webTransport } from '@libp2p/webtransport';
import { multiaddr } from '@multiformats/multiaddr';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { createHelia, type Helia } from 'helia';
import { createLibp2p } from 'libp2p';

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
const LOCAL_IPFS_RECONNECT_INTERVAL_MS = 30_000;
const IPFS_STATUS_INTERVAL_MS = 5_000;
const DEFAULT_GLOBAL_IPFS_BOOTSTRAP_MULTIADDRS = [
	'/dns/am6.bootstrap.libp2p.io/tcp/443/wss/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
	'/dns/ny5.bootstrap.libp2p.io/tcp/443/wss/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
	'/dns/sg1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
	'/dns/sv15.bootstrap.libp2p.io/tcp/443/wss/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
] as const;
const DEFAULT_LOCAL_IPFS_MULTIADDRS = [
	'/ip4/127.0.0.1/tcp/4002/ws/p2p/12D3KooWPp5C2RJQvTKRfTiwSgKxme9HcUY9zUt354RGpgb5zMBq'
] as const;

function configuredGlobalBootstrapMultiaddrs(): string[] {
	const configured = import.meta.env.VITE_IPFS_BOOTSTRAP_ADDRS?.split(',')
		.map((value: string) => value.trim())
		.filter(Boolean);
	return configured?.length ? configured : [...DEFAULT_GLOBAL_IPFS_BOOTSTRAP_MULTIADDRS];
}

function configuredLocalBootstrapMultiaddrs(): string[] {
	const configured = import.meta.env.VITE_LOCAL_IPFS_BOOTSTRAP_ADDRS?.split(',')
		.map((value: string) => value.trim())
		.filter(Boolean);
	return configured?.length ? configured : [...DEFAULT_LOCAL_IPFS_MULTIADDRS];
}

function configuredBootstrapMultiaddrs(): string[] {
	return [...new Set([...configuredGlobalBootstrapMultiaddrs(), ...configuredLocalBootstrapMultiaddrs()])];
}

function isDialableMultiaddr(value: string): boolean {
	return value.includes('/p2p/');
}

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
	ipfsSwarmAddresses: string[];
	ipfsConnectedAddresses: string[];
	ipfsLastLocalDialError: string;
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
	ipfsSwarmAddresses: [...DEFAULT_LOCAL_IPFS_MULTIADDRS],
	ipfsConnectedAddresses: [],
	ipfsLastLocalDialError: '',
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
		const libp2p = await createLibp2p({
			addresses: {
				listen: []
			},
			connectionGater: {
				denyDialMultiaddr: async () => false,
				filterMultiaddrForPeer: async () => true
			},
			transports: [webSockets(), webRTC(), webTransport(), circuitRelayTransport()],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			peerDiscovery: [
				bootstrap({
					list: configuredBootstrapMultiaddrs()
				})
			],
			services: {
				identify: identify(),
				ping: ping(),
				dht: kadDHT({
					clientMode: true
				})
			}
		});

		const node = await createHelia({ libp2p });
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

async function connectHeliaToLocalIpfs(node: Helia): Promise<void> {
	let lastError: unknown = null;

	for (const target of configuredLocalBootstrapMultiaddrs().filter(isDialableMultiaddr)) {
		const alreadyConnected = node.libp2p
			.getConnections()
			.some((connection) => connection.remoteAddr?.toString?.() === target || connection.remoteAddr?.toString?.().includes(target.split('/p2p/')[1] ?? ''));
		if (alreadyConnected) {
			connections.ipfsLastLocalDialError = '';
			return;
		}

		try {
			await node.libp2p.dial(multiaddr(target));
			connections.ipfsLastLocalDialError = '';
			return;
		} catch (error) {
			lastError = error;
			connections.ipfsLastLocalDialError = error instanceof Error ? error.message : String(error);
		}
	}

	if (lastError != null) {
		console.warn('Background local IPFS reconnect failed', lastError);
	}
}

function updateIpfsStatus(node: Helia): void {
	const allConnections = node.libp2p.getConnections();
	const connectionCount = allConnections.length;
	const localBootstrapMultiaddrs = configuredLocalBootstrapMultiaddrs();
	const localPeerIds = localBootstrapMultiaddrs.map((addr) => addr.split('/p2p/')[1] ?? '').filter(Boolean);
	const localConnected = allConnections.some((connection) => localPeerIds.includes(connection.remotePeer?.toString() ?? ''));
	const connectedAddresses = new Set(allConnections.map((connection) => connection.remoteAddr?.toString?.() ?? '').filter(Boolean));

	for (const connection of allConnections) {
		const remotePeerId = connection.remotePeer?.toString() ?? '';
		if (!remotePeerId) continue;

		for (const target of localBootstrapMultiaddrs) {
			if (target.includes(`/p2p/${remotePeerId}`)) {
				connectedAddresses.add(target);
			}
		}
	}

	connections.ipfsConnections = connectionCount;
	connections.ipfsMultiaddrs = node.libp2p.getMultiaddrs().map((addr: { toString(): string }) => addr.toString());
	connections.ipfsSwarmAddresses = [...DEFAULT_LOCAL_IPFS_MULTIADDRS];
	connections.ipfsConnectedAddresses = [...connectedAddresses].sort();
	connections.ipfsStatus =
		connectionCount > 0
			? `Connected to global IPFS (${connectionCount} peer${connectionCount === 1 ? '' : 's'}${localConnected ? ', local node linked' : ', local node reconnecting'})`
			: `Running in browser (discovering global IPFS peers${localConnected ? ', local node linked' : ', local node reconnecting'}...)`;
}

export function startAppConnections() {
	if (started) return stopConnections ?? (() => {});
	started = true;

	let active = true;
	let unsubscribeNewHeads: (() => void) | undefined;
	let connectedApi: ApiPromise | null = null;
	let unsubscribeIndexerStatus: (() => void) | undefined;
	let ipfsConnectionInterval: ReturnType<typeof setInterval> | undefined;
	let localReconnectInterval: ReturnType<typeof setInterval> | undefined;
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
			updateIpfsStatus(node);
			void connectHeliaToLocalIpfs(node);

			ipfsConnectionInterval = setInterval(() => {
				if (!active) return;
				updateIpfsStatus(node);
			}, IPFS_STATUS_INTERVAL_MS);
			localReconnectInterval = setInterval(() => {
				if (!active) return;
				void connectHeliaToLocalIpfs(node);
			}, LOCAL_IPFS_RECONNECT_INTERVAL_MS);
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
		if (localReconnectInterval) clearInterval(localReconnectInterval);
		void connectedApi?.disconnect();
		started = false;
		stopConnections = null;
	};

	return stopConnections;
}
