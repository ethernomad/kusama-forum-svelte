export type IndexSpan = { start: number; end: number };

export type CustomBytes32Key = {
	type: 'Custom';
	value: {
		name: string;
		kind: 'bytes32';
		value: string;
	};
};

type CompositeKeyPart =
	| { kind: 'bytes32'; value: string }
	| { kind: 'u32'; value: number }
	| { kind: 'u64' | 'u128'; value: string }
	| { kind: 'string'; value: string }
	| { kind: 'bool'; value: boolean };

export type CustomCompositeKey = {
	type: 'Custom';
	value: {
		name: string;
		kind: 'composite';
		value: CompositeKeyPart[];
	};
};

export type IndexerEventKey = CustomBytes32Key | CustomCompositeKey;

export type DecodedIndexerEvent = {
	blockNumber?: number;
	eventIndex?: number;
	blockTime?: number | string;
	blockTimestamp?: number | string;
	timestamp?: number | string;
	event: {
		palletName: string;
		eventName: string;
		fields: Record<string, unknown>;
	};
};

export type IndexerSubscriptionMessage = {
	jsonrpc?: string;
	method?: string;
	params?: {
		subscription?: string;
		result?: {
			type?: string;
			data?: unknown;
			key?: IndexerEventKey;
			event?: DecodedIndexerEvent | null;
			[key: string]: unknown;
		};
	};
};

const INDEXER_ENDPOINT = 'ws://127.0.0.1:8172';
const RECONNECT_DELAY_MS = 2_000;

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

type EventListener = {
	key: IndexerEventKey;
	callback: (message: IndexerSubscriptionMessage) => void;
	subscriptionId: string | null;
	pendingRequestId: number | null;
};

let started = false;
let shouldRun = false;
let socket: WebSocket | null = null;
let socketOpen = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let nextRequestId = 1;
let pendingRequests = new Map<number, PendingRequest>();
let statusSubscriptionRequestId: number | null = null;
let statusSubscriptionId: string | null = null;
const statusListeners = new Map<number, (spans: IndexSpan[]) => void>();
const eventListeners = new Map<number, EventListener>();
let nextListenerId = 1;
let connectionStateHandler:
	| ((state: { status: string; subscriptionStatus: string }) => void)
	| null = null;

function setConnectionState(status: string, subscriptionStatus: string) {
	connectionStateHandler?.({ status, subscriptionStatus });
}

function jsonRpcRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
	ensureStarted();
	return new Promise<T>((resolve, reject) => {
		const send = () => {
			if (!socket || !socketOpen) {
				reject(new Error('Indexer is not connected.'));
				return;
			}
			const id = nextRequestId++;
			pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
			socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
		};

		if (socketOpen) {
			send();
			return;
		}

		ensureConnected();
		const timeout = setTimeout(
			() => reject(new Error('Timed out waiting for indexer connection.')),
			5_000
		);
		const poll = setInterval(() => {
			if (!shouldRun) {
				clearInterval(poll);
				clearTimeout(timeout);
				reject(new Error('Indexer is not running.'));
				return;
			}
			if (!socketOpen) return;
			clearInterval(poll);
			clearTimeout(timeout);
			send();
		}, 50);
	});
}

function subscribeStatusIfNeeded() {
	if (
		!socket ||
		!socketOpen ||
		statusListeners.size === 0 ||
		statusSubscriptionId ||
		statusSubscriptionRequestId != null
	)
		return;
	statusSubscriptionRequestId = nextRequestId++;
	socket.send(
		JSON.stringify({
			jsonrpc: '2.0',
			id: statusSubscriptionRequestId,
			method: 'acuity_subscribeStatus',
			params: {}
		})
	);
	setConnectionState('Connected', 'Subscribing...');
}

function subscribeEventsIfNeeded() {
	if (!socket || !socketOpen) return;
	for (const listener of eventListeners.values()) {
		if (listener.subscriptionId || listener.pendingRequestId != null) continue;
		listener.pendingRequestId = nextRequestId++;
		socket.send(
			JSON.stringify({
				jsonrpc: '2.0',
				id: listener.pendingRequestId,
				method: 'acuity_subscribeEvents',
				params: { key: listener.key }
			})
		);
	}
}

function ensureConnected() {
	if (!shouldRun || socket) return;
	setConnectionState('Connecting...', statusListeners.size > 0 ? 'Subscribing...' : 'Idle');
	socket = new WebSocket(INDEXER_ENDPOINT);

	socket.addEventListener('open', () => {
		socketOpen = true;
		setConnectionState('Connected', statusListeners.size > 0 ? 'Fetching status...' : 'Idle');
		subscribeStatusIfNeeded();
		subscribeEventsIfNeeded();
	});

	socket.addEventListener('message', (event) => {
		const message = JSON.parse(String(event.data)) as {
			id?: number;
			jsonrpc?: string;
			result?: unknown;
			error?: { message?: string };
			method?: string;
			params?: IndexerSubscriptionMessage['params'];
		};

		if (message.id != null) {
			if (pendingRequests.has(message.id)) {
				const pending = pendingRequests.get(message.id)!;
				pendingRequests.delete(message.id);
				if (message.error)
					pending.reject(new Error(message.error.message ?? 'Indexer request failed.'));
				else pending.resolve(message.result);
				return;
			}

			if (statusSubscriptionRequestId === message.id) {
				statusSubscriptionRequestId = null;
				if (typeof message.result === 'string') {
					statusSubscriptionId = message.result;
					setConnectionState('Connected', 'Subscribed to latest blocks');
					void indexStatus()
						.then((spans) => broadcastStatus(spans))
						.catch((error) =>
							setConnectionState(
								'Connected',
								`Request failed: ${error instanceof Error ? error.message : String(error)}`
							)
						);
				}
				return;
			}

			for (const listener of eventListeners.values()) {
				if (listener.pendingRequestId === message.id) {
					listener.pendingRequestId = null;
					if (typeof message.result === 'string') listener.subscriptionId = message.result;
					return;
				}
			}
		}

		if (message.method !== 'acuity_subscription') return;
		const subscriptionId = message.params?.subscription;
		const resultType = message.params?.result?.type;
		if (!subscriptionId || !resultType) return;

		if (resultType === 'status' && subscriptionId === statusSubscriptionId) {
			const result = message.params?.result as { data?: unknown; spans?: unknown } | undefined;
			const spans = Array.isArray(result?.data)
				? (result.data as IndexSpan[])
				: Array.isArray(result?.spans)
					? (result.spans as IndexSpan[])
					: [];
			broadcastStatus(spans);
			setConnectionState('Connected', 'Subscribed to latest blocks');
			return;
		}

		for (const listener of eventListeners.values()) {
			if (listener.subscriptionId === subscriptionId) {
				listener.callback(message as IndexerSubscriptionMessage);
			}
		}
	});

	socket.addEventListener('close', () => {
		socket = null;
		socketOpen = false;
		statusSubscriptionId = null;
		statusSubscriptionRequestId = null;
		for (const listener of eventListeners.values()) {
			listener.subscriptionId = null;
			listener.pendingRequestId = null;
		}
		for (const pending of pendingRequests.values())
			pending.reject(new Error('Indexer connection closed.'));
		pendingRequests = new Map();
		if (!shouldRun) return;
		setConnectionState('Disconnected', 'Subscription closed');
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			ensureConnected();
		}, RECONNECT_DELAY_MS);
	});

	socket.addEventListener('error', () => {
		setConnectionState(
			`Connection failed: could not connect to ${INDEXER_ENDPOINT}`,
			'Unavailable'
		);
	});
}

function broadcastStatus(spans: IndexSpan[]) {
	for (const listener of statusListeners.values()) listener(spans);
}

export function configureIndexerConnectionState(
	handler: ((state: { status: string; subscriptionStatus: string }) => void) | null
) {
	connectionStateHandler = handler;
}

export function ensureStarted() {
	if (started) return;
	started = true;
	shouldRun = true;
	ensureConnected();
}

export function stopIndexer() {
	shouldRun = false;
	started = false;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	socket?.close();
	socket = null;
	socketOpen = false;
	statusSubscriptionId = null;
	statusSubscriptionRequestId = null;
	pendingRequests = new Map();
	for (const listener of eventListeners.values()) {
		listener.subscriptionId = null;
		listener.pendingRequestId = null;
	}
}

export async function indexStatus(): Promise<IndexSpan[]> {
	const result = (await jsonRpcRequest('acuity_indexStatus', {})) as { spans?: IndexSpan[] };
	return result.spans ?? [];
}

export async function getIndexedEvents<T>(params: Record<string, unknown>): Promise<T> {
	return (await jsonRpcRequest('acuity_getEvents', params)) as T;
}

export function subscribeIndexerStatus(listener: (spans: IndexSpan[]) => void) {
	ensureStarted();
	const id = nextListenerId++;
	statusListeners.set(id, listener);
	subscribeStatusIfNeeded();
	return () => {
		statusListeners.delete(id);
		if (statusListeners.size === 0 && socket && socketOpen && statusSubscriptionId) {
			socket.send(
				JSON.stringify({
					jsonrpc: '2.0',
					id: nextRequestId++,
					method: 'acuity_unsubscribeStatus',
					params: { subscription: statusSubscriptionId }
				})
			);
			statusSubscriptionId = null;
		}
	};
}

export function itemIdIndexerKey(itemIdHex: string): CustomBytes32Key {
	return {
		type: 'Custom',
		value: {
			name: 'item_id',
			kind: 'bytes32',
			value: itemIdHex.startsWith('0x') ? itemIdHex : `0x${itemIdHex}`
		}
	};
}

export function getSubscriptionDecodedEvent(
	message: IndexerSubscriptionMessage
): DecodedIndexerEvent | null {
	const result = message.params?.result;
	if (result?.type !== 'event') return null;
	return result.event ?? null;
}

export function subscribeIndexerEvents(
	key: IndexerEventKey,
	callback: (message: IndexerSubscriptionMessage) => void
) {
	ensureStarted();
	const id = nextListenerId++;
	eventListeners.set(id, { key, callback, subscriptionId: null, pendingRequestId: null });
	subscribeEventsIfNeeded();
	return () => {
		const listener = eventListeners.get(id);
		eventListeners.delete(id);
		if (listener?.subscriptionId && socket && socketOpen) {
			socket.send(
				JSON.stringify({
					jsonrpc: '2.0',
					id: nextRequestId++,
					method: 'acuity_unsubscribeEvents',
					params: { subscription: listener.subscriptionId }
				})
			);
		}
	};
}

