import type { ApiPromise } from '@polkadot/api';
import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';
import { injectedAccounts } from './accounts.svelte';
import { connections } from './connections.svelte';
import { subscribeIndexerEvents, type CustomBytes32Key } from './indexer.svelte';

type AccountBalance = {
	loading: boolean;
	raw: bigint | null;
	error: string | null;
};

type BalancesState = {
	byAddress: Record<string, AccountBalance>;
	tokenDecimals: number;
	tokenSymbol: string;
	status: string;
};

const RECONCILE_INTERVAL_MS = 750;

export const accountBalances = $state<BalancesState>({
	byAddress: {},
	tokenDecimals: 12,
	tokenSymbol: 'UNIT',
	status: 'Idle'
});

let started = false;
let stopWatcher: (() => void) | null = null;

function normalizeAddressKey(address: string) {
	return address.trim();
}

function ensureBalanceState(address: string) {
	const key = normalizeAddressKey(address);
	accountBalances.byAddress[key] ??= { loading: true, raw: null, error: null };
	return accountBalances.byAddress[key];
}

function setLoading(address: string) {
	accountBalances.byAddress[normalizeAddressKey(address)] = { loading: true, raw: null, error: null };
}

function setValue(address: string, raw: bigint) {
	accountBalances.byAddress[normalizeAddressKey(address)] = { loading: false, raw, error: null };
}

function setError(address: string, error: string) {
	accountBalances.byAddress[normalizeAddressKey(address)] = { loading: false, raw: null, error };
}

function trimUnknownAddresses(addresses: string[]) {
	const keep = new Set(addresses.map(normalizeAddressKey));
	for (const address of Object.keys(accountBalances.byAddress)) {
		if (!keep.has(address)) delete accountBalances.byAddress[address];
	}
}

function updateTokenFormat(api: ApiPromise) {
	accountBalances.tokenDecimals = api.registry.chainDecimals[0] ?? 12;
	accountBalances.tokenSymbol = api.registry.chainTokens[0] ?? 'UNIT';
}

async function fetchBalance(api: ApiPromise, address: string) {
	ensureBalanceState(address);
	try {
		const accountInfo = await (api.query.system.account as unknown as (address: string) => Promise<{
			data?: { free?: { toString(): string } | bigint | string | number };
		}>)(address);
		const free = accountInfo?.data?.free;
		const raw = BigInt(typeof free === 'object' && free !== null && 'toString' in free ? free.toString() : (free ?? 0));
		setValue(address, raw);
	} catch (error) {
		setError(address, error instanceof Error ? error.message : String(error));
	}
}

function formatWithThousands(value: string) {
	return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatBalanceValue(raw: bigint | null) {
	if (raw == null) return '—';
	const decimals = Math.max(0, accountBalances.tokenDecimals);
	const symbol = accountBalances.tokenSymbol;
	if (decimals === 0) return `${formatWithThousands(raw.toString())} ${symbol}`;

	const base = 10n ** BigInt(decimals);
	const whole = raw / base;
	const fraction = raw % base;
	const fractionText = fraction.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
	return `${formatWithThousands(whole.toString())}${fractionText ? `.${fractionText}` : ''} ${symbol}`;
}

export function getAccountBalanceLabel(address: string | null | undefined) {
	if (!address) return '';
	const balance = accountBalances.byAddress[normalizeAddressKey(address)];
	if (!balance) return '…';
	if (balance.loading) return '…';
	if (balance.error) return '—';
	return formatBalanceValue(balance.raw);
}

export function startAccountBalanceWatcher() {
	if (started) return stopWatcher ?? (() => {});
	started = true;

	let active = true;
	let reconcileInterval: ReturnType<typeof setInterval> | undefined;
	let lastApi: ApiPromise | null = null;
	let watchedAddresses = new Set<string>();
	let pendingInitialFetches = new Set<string>();
	const unsubscribeByAddress = new Map<string, () => void>();
	const keyHexToAddress = new Map<string, string>();

	const reconcile = async () => {
		if (!active) return;
		const api = connections.api;
		const addresses = injectedAccounts.accounts.map((account) => normalizeAddressKey(account.address)).filter(Boolean);
		trimUnknownAddresses(addresses);

		if (!api || addresses.length === 0) {
			watchedAddresses = new Set(addresses);
			if (addresses.length === 0) accountBalances.status = 'No accounts selected';
			for (const unsubscribe of unsubscribeByAddress.values()) unsubscribe();
			unsubscribeByAddress.clear();
			return;
		}

		const apiChanged = api !== lastApi;
		if (apiChanged) {
			lastApi = api;
			updateTokenFormat(api);
			pendingInitialFetches = new Set(addresses);
		}

		const previousWatched = watchedAddresses;
		const nextWatched = new Set(addresses);
		watchedAddresses = nextWatched;

		for (const address of addresses) {
			if (!keyHexToAddressKeyHex(address)) continue;
			const existingBalance = accountBalances.byAddress[address];
			const needsInitialStateFetch =
				pendingInitialFetches.has(address) ||
				!previousWatched.has(address) ||
				!existingBalance ||
				existingBalance.loading ||
				!!existingBalance.error;
			if (!existingBalance) setLoading(address);
			if (needsInitialStateFetch) {
				pendingInitialFetches.delete(address);
				void fetchBalance(api, address);
			}
		}

		for (const [address, unsubscribe] of unsubscribeByAddress.entries()) {
			if (!nextWatched.has(address)) {
				unsubscribe();
				unsubscribeByAddress.delete(address);
			}
		}

		for (const address of nextWatched) {
			if (unsubscribeByAddress.has(address)) continue;
			const keyHex = keyHexToAddressKeyHex(address);
			if (!keyHex) continue;
			const key: CustomBytes32Key = {
				type: 'Custom',
				value: { name: 'account_id', kind: 'bytes32', value: keyHex }
			};
			unsubscribeByAddress.set(
				address,
				subscribeIndexerEvents(key, () => {
					const liveApi = connections.api;
					if (liveApi) void fetchBalance(liveApi, address);
				})
			);
		}

		accountBalances.status = apiChanged
			? 'Loaded account balances from chain state'
			: 'Watching account balance events';
	};

	const keyHexToAddressKeyHex = (address: string) => {
		try {
			const raw = decodeAddress(address);
			if (raw.length !== 32) return null;
			const hex = `0x${Array.from(raw)
				.map((value) => value.toString(16).padStart(2, '0'))
				.join('')}`.toLowerCase();
			keyHexToAddress.set(hex, address);
			return hex;
		} catch {
			return null;
		}
	};

	void cryptoWaitReady().then(() => {
		if (!active) return;
		void reconcile();
		reconcileInterval = setInterval(() => {
			void reconcile();
		}, RECONCILE_INTERVAL_MS);
	});

	stopWatcher = () => {
		active = false;
		if (reconcileInterval) clearInterval(reconcileInterval);
		for (const unsubscribe of unsubscribeByAddress.values()) unsubscribe();
		unsubscribeByAddress.clear();
		started = false;
		stopWatcher = null;
	};

	return stopWatcher;
}
