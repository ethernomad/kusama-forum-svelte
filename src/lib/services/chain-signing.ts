import { isVirtoAccount, type InjectedAccount } from './accounts.svelte';
import { signExtrinsicWithVirto } from './virto-connect.svelte';

export type SignableExtrinsic = {
	signAndSend: (...args: unknown[]) => Promise<() => void>;
	toHex?: () => string;
};

export async function signAndWaitForInBlock(
	extrinsic: SignableExtrinsic,
	account: InjectedAccount,
	errorMessage = 'Transaction failed on chain.'
): Promise<void> {
	if (typeof window === 'undefined') {
		throw new Error('Signing is only available in the browser.');
	}

	if (isVirtoAccount(account)) {
		if (typeof extrinsic.toHex !== 'function') {
			throw new Error('This extrinsic cannot be serialized for Virto signing.');
		}
		await signExtrinsicWithVirto(account, extrinsic.toHex());
		return;
	}

	const { web3FromSource } = await import('@polkadot/extension-dapp');
	const injector = await web3FromSource(String(account.meta.source ?? ''));
	await new Promise<void>((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		void extrinsic
			.signAndSend(
				account.address,
				{ signer: injector.signer },
				(result: {
					status: { isInBlock?: boolean; isFinalized?: boolean };
					dispatchError?: unknown;
				}) => {
					if (result.dispatchError) {
						unsubscribe?.();
						reject(new Error(errorMessage));
						return;
					}
					if (result.status?.isInBlock || result.status?.isFinalized) {
						unsubscribe?.();
						resolve();
					}
				}
			)
			.then((unsub: () => void) => {
				unsubscribe = unsub;
			})
			.catch(reject);
	});
}
