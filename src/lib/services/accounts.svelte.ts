import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';

import { getVirtoSessionAccount, restoreVirtoSession } from './virto-connect';

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

type AccountsState = {
	status: string;
	extensionEnabled: boolean;
	accounts: InjectedAccount[];
	activeAddress: string;
	activeAccount: InjectedAccount | null;
};

export const injectedAccounts = $state<AccountsState>({
	status: 'Checking for accounts...',
	extensionEnabled: false,
	accounts: [],
	activeAddress: '',
	activeAccount: null
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

export function formatAccountLabel(account: InjectedAccount | null) {
	if (!account) return 'Select account';
	if (account.provider === 'virto') {
		return account.meta.name?.trim() || account.meta.username?.trim() || 'Virto passkey';
	}
	return account.meta.name?.trim() || 'Unnamed account';
}

export function formatShortAddress(address: string) {
	if (address.length <= 12) return address;
	return `${address.slice(0, 6)}…${address.slice(-6)}`;
}
