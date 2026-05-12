import type { ApiPromise } from '@polkadot/api';
import { encodeAddress } from '@polkadot/util-crypto';

import type { InjectedAccount } from './accounts.svelte';
import { signAndWaitForInBlock } from './chain-signing';
import { accountAddressToHex } from './content';
import { loadProfile } from './profile';

export type AccountTrustStatus = {
	isOwnAccount: boolean;
	isDirectlyTrusted: boolean;
	isTrustedViaExtendedGraph: boolean;
	trustedVia: string[];
};

export type TrustedAccountSummary = {
	address: string;
	displayName: string;
	profileItemIdHex: string | null;
	imagePreviewDataUrl: string | null;
};

function trustedAccountsQuery(api: ApiPromise) {
	return (api.query as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)
		.trustedAccounts;
}

function trustedAccountsTx(api: ApiPromise) {
	return (api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>)
		.trustedAccounts;
}

function parseCount(value: unknown): number {
	const primitive =
		typeof value === 'object' &&
		value !== null &&
		'toPrimitive' in value &&
		typeof value.toPrimitive === 'function'
			? value.toPrimitive()
			: value;
	const count = typeof primitive === 'number' ? primitive : Number(primitive);
	return Number.isInteger(count) && count >= 0 ? count : 0;
}

function parseAccountAddress(value: unknown): string | null {
	if (typeof value === 'string') {
		try {
			return encodeAddress(value);
		} catch {
			return null;
		}
	}
	if (typeof value === 'object' && value !== null) {
		const optionLike = value as {
			isNone?: boolean;
			isSome?: boolean;
			unwrap?: () => unknown;
			toPrimitive?: () => unknown;
			toJSON?: () => unknown;
			toString?: () => string;
		};
		if (optionLike.isNone) return null;
		if (optionLike.isSome && optionLike.unwrap) return parseAccountAddress(optionLike.unwrap());
		const primitive = optionLike.toPrimitive?.();
		if (primitive != null && primitive !== value) {
			const parsed = parseAccountAddress(primitive);
			if (parsed) return parsed;
		}
		const json = optionLike.toJSON?.();
		if (json != null && json !== value) {
			const parsed = parseAccountAddress(json);
			if (parsed) return parsed;
		}
		try {
			return encodeAddress(optionLike.toString?.() ?? '');
		} catch {
			return null;
		}
	}
	return null;
}

export function shortAddress(address: string): string {
	return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export function accountHexToAddress(accountHex: string): string | null {
	try {
		return encodeAddress(accountHex);
	} catch {
		return null;
	}
}

export async function fetchTrustedAccounts(api: ApiPromise, address: string): Promise<string[]> {
	const trusted = trustedAccountsQuery(api);
	const countValue = await trusted.accountTrustedAccountListCount(address);
	const count = parseCount(countValue);
	if (count === 0) return [];

	const results = await Promise.all(
		Array.from({ length: count }, async (_, index) => {
			const entry = await trusted.accountTrustedAccountList(address, index);
			return parseAccountAddress(entry);
		})
	);

	return results.filter((entry): entry is string => !!entry);
}

export async function isDirectlyTrusted(
	api: ApiPromise,
	trusterAddress: string,
	trusteeAddress: string
): Promise<boolean> {
	const trusted = trustedAccountsQuery(api);
	const value = await trusted.accountTrustedAccountIndex(trusterAddress, trusteeAddress);
	const index = parseCount(value);
	return index > 0;
}

export async function getAccountTrustStatus(
	api: ApiPromise,
	viewerAddress: string,
	authorAddress: string
): Promise<AccountTrustStatus> {
	const viewerHex = accountAddressToHex(viewerAddress);
	const authorHex = accountAddressToHex(authorAddress);
	if (viewerHex === authorHex) {
		return {
			isOwnAccount: true,
			isDirectlyTrusted: false,
			isTrustedViaExtendedGraph: true,
			trustedVia: []
		};
	}

	const directTrusted = await fetchTrustedAccounts(api, viewerAddress);
	const directTrustedHex = new Set(directTrusted.map((entry) => accountAddressToHex(entry)));
	const isDirect = directTrustedHex.has(authorHex);
	if (isDirect) {
		return {
			isOwnAccount: false,
			isDirectlyTrusted: true,
			isTrustedViaExtendedGraph: true,
			trustedVia: []
		};
	}

	const trustedViaChecks = await Promise.all(
		directTrusted.map(async (trustedAddress) => {
			const trustsAuthor = await isDirectlyTrusted(api, trustedAddress, authorAddress);
			return trustsAuthor ? trustedAddress : null;
		})
	);
	const trustedVia = trustedViaChecks.filter((entry): entry is string => !!entry);

	return {
		isOwnAccount: false,
		isDirectlyTrusted: false,
		isTrustedViaExtendedGraph: trustedVia.length > 0,
		trustedVia
	};
}

export async function loadTrustedAccountSummary(
	api: ApiPromise,
	address: string
): Promise<TrustedAccountSummary> {
	const normalizedAddress = parseAccountAddress(address) ?? address;
	try {
		const profile = await loadProfile(api, normalizedAddress);
		return {
			address: normalizedAddress,
			displayName: profile.draft.name.trim() || shortAddress(normalizedAddress),
			profileItemIdHex: profile.itemIdHex,
			imagePreviewDataUrl: profile.imagePreviewDataUrl
		};
	} catch {
		return {
			address: normalizedAddress,
			displayName: shortAddress(normalizedAddress),
			profileItemIdHex: null,
			imagePreviewDataUrl: null
		};
	}
}

export async function loadTrustedAccountSummaries(
	api: ApiPromise,
	addresses: string[]
): Promise<TrustedAccountSummary[]> {
	const summaries = await Promise.all(
		addresses.map((address) => loadTrustedAccountSummary(api, address))
	);
	return summaries.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function trustAccount(
	api: ApiPromise,
	account: InjectedAccount,
	address: string
): Promise<void> {
	const tx = trustedAccountsTx(api).trustAccount;
	if (typeof tx !== 'function')
		throw new Error('TrustedAccounts.trustAccount extrinsic is unavailable.');
	await signAndWaitForInBlock(
		tx(address) as Parameters<typeof signAndWaitForInBlock>[0],
		account,
		'Failed to trust account.'
	);
}

export async function untrustAccount(
	api: ApiPromise,
	account: InjectedAccount,
	address: string
): Promise<void> {
	const tx = trustedAccountsTx(api).untrustAccount;
	if (typeof tx !== 'function')
		throw new Error('TrustedAccounts.untrustAccount extrinsic is unavailable.');
	await signAndWaitForInBlock(
		tx(address) as Parameters<typeof signAndWaitForInBlock>[0],
		account,
		'Failed to untrust account.'
	);
}
