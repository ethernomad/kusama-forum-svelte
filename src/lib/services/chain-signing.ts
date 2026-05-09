import type { InjectedAccount } from './accounts.svelte';

export type SignableExtrinsic = {
	signAndSend: Function;
};

export async function signAndWaitForInBlock(
	extrinsic: SignableExtrinsic,
	account: InjectedAccount,
	errorMessage = 'Transaction failed on chain.'
): Promise<void> {
	if (typeof window === 'undefined') {
		throw new Error('Signing is only available in the browser.');
	}
	const { web3FromSource } = await import('@polkadot/extension-dapp');
	const injector = await web3FromSource(String(account.meta.source ?? ''));
	await new Promise<void>((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		void extrinsic
			.signAndSend(
				account.address,
				{ signer: injector.signer },
				(result: { status: { isInBlock?: boolean }; dispatchError?: unknown }) => {
					if (result.dispatchError) {
						unsubscribe?.();
						reject(new Error(errorMessage));
						return;
					}
					if (result.status?.isInBlock) {
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
