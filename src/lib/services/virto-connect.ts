import { accountAddressToHex } from './content';

const SDK_IMPORT_URL =
	'https://cdn.jsdelivr.net/npm/@virtonetwork/sdk@0.0.4-alpha.13/dist/esm/sdk.js';
const DEFAULT_SERVER_URL = 'https://vc.connect-test.xyz:5000/api';
const DEFAULT_PROVIDER_URL = 'ws://127.0.0.1:9944';
const STORAGE_CONFIG_KEY = 'kusama-forum.virto.config';
const STORAGE_SESSION_KEY = 'kusama-forum.virto.session';

type VirtoSdkAuth = {
	isRegistered(username: string): Promise<boolean>;
	register(user: {
		profile: { id: string; name: string; displayName: string };
		metadata: Record<string, unknown>;
	}): Promise<unknown>;
	connect(username: string): Promise<unknown>;
	sign(username: string, command: { hex: string }): Promise<unknown>;
};

type VirtoTransactionUpdate = {
	type?: string;
	transaction?: unknown;
	[key: string]: unknown;
};

type VirtoSdk = {
	auth: VirtoSdkAuth;
	onTransactionUpdate?(callback: (event: VirtoTransactionUpdate) => void): void;
};

type VirtoSdkConstructor = new (config: {
	federate_server: string;
	provider_url: string;
	confirmation_level?: string;
	onProviderStatusChange?: (status: unknown) => void;
}) => VirtoSdk;

type VirtoSession = {
	username: string;
	address: string;
};

type PendingTransactionWaiter = {
	resolve: () => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
};

type VirtoState = {
	status: string;
	loading: boolean;
	configured: boolean;
	connected: boolean;
	serverUrl: string;
	providerUrl: string;
	username: string;
	displayName: string;
	address: string;
	error: string;
	providerStatus: string;
	lastTransactionStatus: string;
	lastTransactionSummary: string;
};

export const virtoState = $state<VirtoState>({
	status: 'Virto passkey not configured',
	loading: false,
	configured: false,
	connected: false,
	serverUrl: DEFAULT_SERVER_URL,
	providerUrl: DEFAULT_PROVIDER_URL,
	username: '',
	displayName: '',
	address: '',
	error: '',
	providerStatus: '',
	lastTransactionStatus: '',
	lastTransactionSummary: ''
});

let sdkModulePromise: Promise<VirtoSdkConstructor> | null = null;
let sdkInstance: VirtoSdk | null = null;
let sdkCacheKey = '';
let transactionListenerAttached = false;
const pendingTransactionWaiters: PendingTransactionWaiter[] = [];

function isBrowser() {
	return typeof window !== 'undefined';
}

function saveConfig() {
	if (!isBrowser()) return;
	window.localStorage.setItem(
		STORAGE_CONFIG_KEY,
		JSON.stringify({
			serverUrl: virtoState.serverUrl,
			providerUrl: virtoState.providerUrl,
			displayName: virtoState.displayName
		})
	);
}

function saveSession(session: VirtoSession | null) {
	if (!isBrowser()) return;
	if (!session) {
		window.localStorage.removeItem(STORAGE_SESSION_KEY);
		return;
	}
	window.localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
}

function loadStoredJson<T>(key: string): T | null {
	if (!isBrowser()) return null;
	const value = window.localStorage.getItem(key);
	if (!value) return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function extractAddress(value: unknown): string {
	if (!value) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const direct = record.address;
		if (typeof direct === 'string') return direct;
		const nested = record.user;
		if (nested && typeof nested === 'object') {
			const nestedAddress = (nested as Record<string, unknown>).address;
			if (typeof nestedAddress === 'string') return nestedAddress;
		}
	}
	return '';
}

function describeTransaction(event: VirtoTransactionUpdate) {
	const type = String(event.type ?? 'unknown');
	const transaction = event.transaction;
	if (typeof transaction === 'string') return `${type}: ${transaction}`;
	if (transaction && typeof transaction === 'object') {
		const hash = (transaction as Record<string, unknown>).hash;
		if (typeof hash === 'string') return `${type}: ${hash}`;
	}
	return type;
}

function flushPendingWaiters(error: Error | null) {
	while (pendingTransactionWaiters.length > 0) {
		const waiter = pendingTransactionWaiters.shift();
		if (!waiter) continue;
		clearTimeout(waiter.timeoutId);
		if (error) waiter.reject(error);
		else waiter.resolve();
	}
}

function attachTransactionListener(sdk: VirtoSdk) {
	if (transactionListenerAttached || typeof sdk.onTransactionUpdate !== 'function') return;
	transactionListenerAttached = true;
	sdk.onTransactionUpdate((event) => {
		const type = String(event.type ?? '');
		virtoState.lastTransactionStatus = type;
		virtoState.lastTransactionSummary = describeTransaction(event);
		if (type === 'failed') {
			flushPendingWaiters(new Error('Virto transaction failed.'));
			return;
		}
		if (type === 'included' || type === 'finalized') {
			flushPendingWaiters(null);
		}
	});
}

async function loadSdkConstructor(): Promise<VirtoSdkConstructor> {
	if (!sdkModulePromise) {
		sdkModulePromise = import(/* @vite-ignore */ SDK_IMPORT_URL).then((module) => {
			const constructor = (module as { default?: VirtoSdkConstructor }).default;
			if (!constructor) throw new Error('Virto SDK could not be loaded.');
			return constructor;
		});
	}
	return sdkModulePromise;
}

async function getSdk(): Promise<VirtoSdk> {
	const serverUrl = virtoState.serverUrl.trim();
	const providerUrl = virtoState.providerUrl.trim();
	if (!serverUrl || !providerUrl) {
		throw new Error('Set both Virto server URL and provider URL before using passkey login.');
	}
	const cacheKey = `${serverUrl}::${providerUrl}`;
	if (sdkInstance && sdkCacheKey === cacheKey) return sdkInstance;

	const Sdk = await loadSdkConstructor();
	sdkInstance = new Sdk({
		federate_server: serverUrl,
		provider_url: providerUrl,
		confirmation_level: 'submitted',
		onProviderStatusChange: (status) => {
			virtoState.providerStatus =
				typeof status === 'string' ? status : JSON.stringify(status, null, 2);
		}
	});
	sdkCacheKey = cacheKey;
	transactionListenerAttached = false;
	attachTransactionListener(sdkInstance);
	virtoState.configured = true;
	virtoState.status = 'Virto passkey ready';
	saveConfig();
	return sdkInstance;
}

function setConnectedSession(session: VirtoSession | null) {
	if (!session) {
		virtoState.connected = false;
		virtoState.username = '';
		virtoState.address = '';
		virtoState.status = virtoState.configured
			? 'Virto passkey ready'
			: 'Virto passkey not configured';
		saveSession(null);
		return;
	}
	virtoState.connected = true;
	virtoState.username = session.username;
	virtoState.address = session.address;
	virtoState.status = `Connected with Virto as ${session.username}`;
	saveSession(session);
}

export function restoreVirtoSession() {
	const storedConfig = loadStoredJson<{
		serverUrl?: string;
		providerUrl?: string;
		displayName?: string;
	}>(STORAGE_CONFIG_KEY);
	if (storedConfig) {
		if (storedConfig.serverUrl) virtoState.serverUrl = storedConfig.serverUrl;
		if (storedConfig.providerUrl) virtoState.providerUrl = storedConfig.providerUrl;
		if (storedConfig.displayName) virtoState.displayName = storedConfig.displayName;
	}
	virtoState.configured =
		virtoState.serverUrl.trim().length > 0 && virtoState.providerUrl.trim().length > 0;

	const storedSession = loadStoredJson<VirtoSession>(STORAGE_SESSION_KEY);
	if (storedSession?.username && storedSession?.address) {
		setConnectedSession(storedSession);
	} else {
		setConnectedSession(null);
	}
}

export function configureVirto(params: {
	serverUrl?: string;
	providerUrl?: string;
	displayName?: string;
}) {
	if (params.serverUrl != null) virtoState.serverUrl = params.serverUrl;
	if (params.providerUrl != null) virtoState.providerUrl = params.providerUrl;
	if (params.displayName != null) virtoState.displayName = params.displayName;
	virtoState.configured =
		virtoState.serverUrl.trim().length > 0 && virtoState.providerUrl.trim().length > 0;
	virtoState.status = virtoState.connected
		? `Connected with Virto as ${virtoState.username}`
		: virtoState.configured
			? 'Virto passkey ready'
			: 'Virto passkey not configured';
	sdkInstance = null;
	sdkCacheKey = '';
	transactionListenerAttached = false;
	saveConfig();
}

export function getVirtoSessionAccount() {
	if (!virtoState.connected || !virtoState.address || !virtoState.username) return null;
	return {
		address: virtoState.address,
		provider: 'virto' as const,
		meta: {
			name: virtoState.displayName.trim() || virtoState.username,
			source: 'virto-passkey',
			username: virtoState.username,
			provider: 'virto' as const
		}
	};
}

export async function registerWithVirto(params: { username: string; name: string }) {
	virtoState.loading = true;
	virtoState.error = '';
	try {
		const sdk = await getSdk();
		const username = params.username.trim();
		const name = params.name.trim() || username;
		if (!username) throw new Error('Enter a username to register with Virto.');
		const alreadyRegistered = await sdk.auth.isRegistered(username);
		if (alreadyRegistered) throw new Error('That Virto username is already registered.');
		const result = await sdk.auth.register({
			profile: { id: username, name, displayName: username },
			metadata: {}
		});
		const address = extractAddress(result);
		if (!address) throw new Error('Virto registration succeeded but no address was returned.');
		virtoState.displayName = name;
		setConnectedSession({ username, address });
		return { username, address };
	} catch (error) {
		virtoState.error = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		virtoState.loading = false;
	}
}

export async function loginWithVirto(usernameInput: string) {
	virtoState.loading = true;
	virtoState.error = '';
	try {
		const sdk = await getSdk();
		const username = usernameInput.trim();
		if (!username) throw new Error('Enter a username to sign in with Virto.');
		const result = await sdk.auth.connect(username);
		const address = extractAddress(result);
		if (!address) throw new Error('Virto login succeeded but no address was returned.');
		setConnectedSession({ username, address });
		return { username, address };
	} catch (error) {
		virtoState.error = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		virtoState.loading = false;
	}
}

export function disconnectVirto() {
	flushPendingWaiters(new Error('Virto session closed.'));
	virtoState.error = '';
	setConnectedSession(null);
}

export async function signExtrinsicWithVirto(
	account: { address: string; meta?: { username?: string } },
	extrinsicHex: string
) {
	virtoState.loading = true;
	virtoState.error = '';
	try {
		const sdk = await getSdk();
		const username = account.meta?.username?.trim() || virtoState.username.trim();
		if (!username) throw new Error('No Virto username is active for signing.');
		if (!extrinsicHex.startsWith('0x'))
			throw new Error('Virto signing requires a hex-encoded extrinsic.');

		let waitedForChainUpdate = false;
		const updatePromise = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const index = pendingTransactionWaiters.findIndex((entry) => entry.timeoutId === timeoutId);
				if (index >= 0) pendingTransactionWaiters.splice(index, 1);
				resolve();
			}, 45_000);
			pendingTransactionWaiters.push({
				resolve: () => {
					waitedForChainUpdate = true;
					resolve();
				},
				reject,
				timeoutId
			});
		});

		await sdk.auth.sign(username, { hex: extrinsicHex });
		await updatePromise;
		virtoState.lastTransactionStatus = waitedForChainUpdate
			? virtoState.lastTransactionStatus || 'included'
			: 'submitted';
		virtoState.status = `Connected with Virto as ${virtoState.username}`;
	} catch (error) {
		virtoState.error = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		virtoState.loading = false;
	}
}

export function isVirtoAddress(address: string) {
	return (
		!!virtoState.address && accountAddressToHex(virtoState.address) === accountAddressToHex(address)
	);
}
