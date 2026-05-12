import type { ApiPromise } from '@polkadot/api';
import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';

import { connections } from './connections.svelte';
import { loadProfile } from './profile';
import { getVirtoSessionAccount, restoreVirtoSession } from './virto-connect.svelte';

const APP_NAME = 'Kusama Forum';
const STORAGE_KEY = 'kusama-forum.active-account';

export type AccountProvider = 'extension' | 'virto';

export type InjectedAccount = {
	address: string;
	provider: AccountProvider;
	meta: {
		name?: string;
		source?: string;
		username?: string;
		provider?: AccountProvider;
		[key: string]: unknown;
	};
};

type AccountProfileSummary = {
	loading: boolean;
	name: string | null;
	error: string | null;
};

type AccountsState = {
	status: string;
	extensionEnabled: boolean;
	accounts: InjectedAccount[];
	activeAddress: string;
	activeAccount: InjectedAccount | null;
	profileByAddress: Record<string, AccountProfileSummary>;
};

export const injectedAccounts = $state<AccountsState>({
	status: 'Checking for accounts...',
	extensionEnabled: false,
	accounts: [],
	activeAddress: '',
	activeAccount: null,
	profileByAddress: {}
});

function accountStorageKey(account: InjectedAccount) {
	return `${account.provider}:${account.address}`;
}

function setActiveAccount(address: string) {
	injectedAccounts.activeAddress = address;
	injectedAccounts.activeAccount =
		injectedAccounts.accounts.find((account) => account.address === address) ?? null;

	if (typeof window !== 'undefined') {
		if (injectedAccounts.activeAccount) {
			window.localStorage.setItem(STORAGE_KEY, accountStorageKey(injectedAccounts.activeAccount));
		} else {
			window.localStorage.removeItem(STORAGE_KEY);
		}
	}
}

function syncActiveAccount() {
	const savedKey =
		typeof window === 'undefined' ? '' : (window.localStorage.getItem(STORAGE_KEY) ?? '').trim();
	const nextActiveAccount =
		injectedAccounts.accounts.find((account) => accountStorageKey(account) === savedKey) ??
		injectedAccounts.accounts[0] ??
		null;

	if (nextActiveAccount) {
		setActiveAccount(nextActiveAccount.address);
		return;
	}

	injectedAccounts.activeAddress = '';
	injectedAccounts.activeAccount = null;
}

function combineAccounts(extensionAccounts: InjectedAccount[]) {
	const virtoAccount = getVirtoSessionAccount();
	return [...extensionAccounts, ...(virtoAccount ? [virtoAccount] : [])];
}

function normalizeAddressKey(address: string) {
	return address.trim();
}

function trimUnknownProfileEntries(addresses: string[]) {
	const keep = new Set(addresses.map(normalizeAddressKey));
	for (const address of Object.keys(injectedAccounts.profileByAddress)) {
		if (!keep.has(address)) delete injectedAccounts.profileByAddress[address];
	}
}

function ensureProfileSummary(address: string) {
	const key = normalizeAddressKey(address);
	injectedAccounts.profileByAddress[key] ??= { loading: true, name: null, error: null };
	return injectedAccounts.profileByAddress[key];
}

async function fetchAccountProfileName(api: ApiPromise, address: string) {
	const profileSummary = ensureProfileSummary(address);
	profileSummary.loading = true;
	profileSummary.error = null;

	try {
		const profile = await loadProfile(api, address);
		injectedAccounts.profileByAddress[normalizeAddressKey(address)] = {
			loading: false,
			name: profile.exists ? (profile.draft.name.trim() || null) : null,
			error: null
		};
	} catch (error) {
		injectedAccounts.profileByAddress[normalizeAddressKey(address)] = {
			loading: false,
			name: null,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

function summarizeStatus(
	extensionCount: number,
	virtoConnected: boolean,
	unsupportedCount: number
) {
	const parts: string[] = [];
	parts.push(
		extensionCount > 0
			? `${extensionCount} extension account${extensionCount === 1 ? '' : 's'}`
			: injectedAccounts.extensionEnabled
				? 'no compatible extension accounts'
				: 'no extension'
	);
	if (virtoConnected) parts.push('Virto passkey connected');
	if (unsupportedCount > 0) parts.push(`${unsupportedCount} unsupported hidden`);
	return parts.join(' • ');
}

export async function loadInjectedAccounts() {
	if (typeof window === 'undefined') return;

	restoreVirtoSession();
	injectedAccounts.status = 'Checking for accounts...';

	let extensionAccounts: InjectedAccount[] = [];
	let unsupportedCount = 0;

	try {
		const { web3Accounts, web3Enable } = await import('@polkadot/extension-dapp');
		const extensions = await web3Enable(APP_NAME);

		injectedAccounts.extensionEnabled = extensions.length > 0;

		if (extensions.length > 0) {
			await cryptoWaitReady();
			const allAccounts = (await web3Accounts()) as Array<{
				address: string;
				meta?: Record<string, unknown>;
			}>;
			const supportedAccounts = allAccounts.filter((account) => {
				try {
					return decodeAddress(account.address).length === 32;
				} catch {
					return false;
				}
			});
			unsupportedCount = allAccounts.length - supportedAccounts.length;
			extensionAccounts = supportedAccounts.map((account) => ({
				address: account.address,
				provider: 'extension',
				meta: {
					...(account.meta ?? {}),
					provider: 'extension'
				}
			}));
		}
	} catch (error) {
		injectedAccounts.extensionEnabled = false;
		injectedAccounts.accounts = combineAccounts([]);
		syncActiveAccount();
		injectedAccounts.status = `Extension load failed: ${error instanceof Error ? error.message : String(error)}`;
		return;
	}

	injectedAccounts.accounts = combineAccounts(extensionAccounts);
	injectedAccounts.status = summarizeStatus(
		extensionAccounts.length,
		!!getVirtoSessionAccount(),
		unsupportedCount
	);
	syncActiveAccount();
}

export function selectInjectedAccount(address: string) {
	if (!injectedAccounts.accounts.some((account) => account.address === address)) return;
	setActiveAccount(address);
}

export function isVirtoAccount(account: InjectedAccount | null | undefined): boolean {
	return account?.provider === 'virto';
}

export function getAccountProfileName(address: string | null | undefined) {
	if (!address) return null;
	return injectedAccounts.profileByAddress[normalizeAddressKey(address)]?.name ?? null;
}

export function formatAccountLabel(account: InjectedAccount | null) {
	if (!account) return 'Select account';
	const profileName = getAccountProfileName(account.address)?.trim();
	if (profileName) return profileName;
	if (account.provider === 'virto') {
		return account.meta.name?.trim() || account.meta.username?.trim() || 'Virto passkey';
	}
	return account.meta.name?.trim() || 'Unnamed account';
}

export function formatAccountSecondaryLabel(account: InjectedAccount | null) {
	if (!account) return '';
	const profileName = getAccountProfileName(account.address)?.trim();
	if (!profileName) return '';
	const fallbackLabel =
		account.provider === 'virto'
			? (account.meta.name?.trim() || account.meta.username?.trim() || '')
			: (account.meta.name?.trim() || '');
	return fallbackLabel && fallbackLabel !== profileName ? fallbackLabel : '';
}

let profileWatcherStarted = false;
let stopProfileWatcher: (() => void) | null = null;

export function startAccountProfileWatcher() {
	if (profileWatcherStarted) return stopProfileWatcher ?? (() => {});
	profileWatcherStarted = true;

	let active = true;
	let reconcileInterval: ReturnType<typeof setInterval> | undefined;
	let lastApi: ApiPromise | null = null;
	let watchedAddresses = new Set<string>();
	let pendingFetches = new Set<string>();

	const reconcile = async () => {
		if (!active) return;
		const api = connections.api;
		const addresses = injectedAccounts.accounts
			.map((account) => normalizeAddressKey(account.address))
			.filter(Boolean);
		trimUnknownProfileEntries(addresses);

		if (!api || addresses.length === 0) {
			watchedAddresses = new Set(addresses);
			return;
		}

		const apiChanged = api !== lastApi;
		if (apiChanged) {
			lastApi = api;
			pendingFetches = new Set(addresses);
		}

		const previousWatched = watchedAddresses;
		watchedAddresses = new Set(addresses);

		for (const address of addresses) {
			const existing = injectedAccounts.profileByAddress[address];
			const needsFetch =
				apiChanged ||
				pendingFetches.has(address) ||
				!previousWatched.has(address) ||
				!existing ||
				existing.loading;
			if (!existing) ensureProfileSummary(address);
			if (!needsFetch) continue;
			pendingFetches.delete(address);
			void fetchAccountProfileName(api, address);
		}
	};

	reconcileInterval = setInterval(() => {
		void reconcile();
	}, 1_000);
	void reconcile();

	stopProfileWatcher = () => {
		active = false;
		if (reconcileInterval) clearInterval(reconcileInterval);
		profileWatcherStarted = false;
		stopProfileWatcher = null;
	};

	return stopProfileWatcher;
}

export function formatShortAddress(address: string) {
	if (address.length <= 12) return address;
	return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export function formatAccountDisplayName(account: InjectedAccount | null) {
	if (!account) return 'No account selected';
	return formatAccountLabel(account);
}

export function formatAccountDisplayWithAddress(account: InjectedAccount | null) {
	if (!account) return 'No account selected';
	const secondaryLabel = formatAccountSecondaryLabel(account);
	return secondaryLabel
		? `${formatAccountLabel(account)} (${formatShortAddress(account.address)})`
		: formatAccountLabel(account);
}
