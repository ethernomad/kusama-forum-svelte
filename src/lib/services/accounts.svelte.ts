const APP_NAME = 'Kusama Forum';
const STORAGE_KEY = 'kusama-forum.active-account';

export type InjectedAccount = {
	address: string;
	meta: {
		name?: string;
		source?: string;
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
	status: 'Checking for extension...',
	extensionEnabled: false,
	accounts: [],
	activeAddress: '',
	activeAccount: null
});

function setActiveAccount(address: string) {
	injectedAccounts.activeAddress = address;
	injectedAccounts.activeAccount =
		injectedAccounts.accounts.find((account) => account.address === address) ?? null;

	if (typeof window !== 'undefined') {
		window.localStorage.setItem(STORAGE_KEY, address);
	}
}

function syncActiveAccount() {
	const savedAddress = typeof window === 'undefined' ? '' : window.localStorage.getItem(STORAGE_KEY) ?? '';
	const nextActiveAddress =
		injectedAccounts.accounts.find((account) => account.address === savedAddress)?.address ??
		injectedAccounts.accounts[0]?.address ??
		'';

	if (nextActiveAddress) {
		setActiveAccount(nextActiveAddress);
		return;
	}

	injectedAccounts.activeAddress = '';
	injectedAccounts.activeAccount = null;
}

export async function loadInjectedAccounts() {
	if (typeof window === 'undefined') return;

	injectedAccounts.status = 'Checking for extension...';

	try {
		const { web3Accounts, web3Enable } = await import('@polkadot/extension-dapp');
		const extensions = await web3Enable(APP_NAME);

		injectedAccounts.extensionEnabled = extensions.length > 0;

		if (extensions.length === 0) {
			injectedAccounts.accounts = [];
			injectedAccounts.status = 'No extension found';
			syncActiveAccount();
			return;
		}

		const accounts = (await web3Accounts()) as InjectedAccount[];
		injectedAccounts.accounts = accounts;
		injectedAccounts.status =
			accounts.length > 0
				? `${accounts.length} account${accounts.length === 1 ? '' : 's'} available`
				: 'No accounts available';
		syncActiveAccount();
	} catch (error) {
		injectedAccounts.extensionEnabled = false;
		injectedAccounts.accounts = [];
		injectedAccounts.activeAddress = '';
		injectedAccounts.activeAccount = null;
		injectedAccounts.status = `Failed to load accounts: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export function selectInjectedAccount(address: string) {
	if (!injectedAccounts.accounts.some((account) => account.address === address)) return;
	setActiveAccount(address);
}

export function formatAccountLabel(account: InjectedAccount | null) {
	if (!account) return 'Select account';
	return account.meta.name?.trim() || 'Unnamed account';
}

export function formatShortAddress(address: string) {
	if (address.length <= 12) return address;
	return `${address.slice(0, 6)}…${address.slice(-6)}`;
}
