import type { InjectedAccount } from './accounts.svelte';

export type SignableExtrinsic = {
	signAndSend: Function;
};

type SubmissionResult = {
	status: {
		isBroadcast?: boolean;
		isInBlock?: boolean;
		isFinalized?: boolean;
	};
	dispatchError?: unknown;
};

export async function signAndSubmit(
	extrinsic: SignableExtrinsic,
	account: InjectedAccount,
	errorMessage = 'Transaction failed on chain.'
): Promise<{ waitForFinalization: Promise<void> }> {
	if (typeof window === 'undefined') {
		throw new Error('Signing is only available in the browser.');
	}
	const { web3FromSource } = await import('@polkadot/extension-dapp');
	const injector = await web3FromSource(String(account.meta.source ?? ''));

	let settledSubmission = false;
	let unsubscribe: (() => void) | undefined;
	let resolveFinalization!: () => void;
	let rejectFinalization!: (reason?: unknown) => void;

	const waitForFinalization = new Promise<void>((resolve, reject) => {
		resolveFinalization = resolve;
		rejectFinalization = reject;
	});

	await new Promise<void>((resolveSubmission, rejectSubmission) => {
		const fail = (error: unknown) => {
			unsubscribe?.();
			const failure = error instanceof Error ? error : new Error(String(error));
			console.error('signAndSubmit failed', failure);
			if (!settledSubmission) {
				settledSubmission = true;
				rejectSubmission(failure);
			}
			rejectFinalization(failure);
		};

		void extrinsic
			.signAndSend(
				account.address,
				{ signer: injector.signer },
				(result: SubmissionResult) => {
					if (result.dispatchError) {
						fail(new Error(errorMessage));
						return;
					}
					if (!settledSubmission && (result.status?.isBroadcast || result.status?.isInBlock || result.status?.isFinalized)) {
						settledSubmission = true;
						resolveSubmission();
					}
					if (result.status?.isFinalized) {
						unsubscribe?.();
						resolveFinalization();
					}
				}
			)
			.then((unsub: () => void) => {
				unsubscribe = unsub;
			})
			.catch(fail);
	});

	return { waitForFinalization };
}

export async function signAndFinalize(
	extrinsic: SignableExtrinsic,
	account: InjectedAccount,
	errorMessage = 'Transaction failed on chain.'
): Promise<void> {
	const { waitForFinalization } = await signAndSubmit(extrinsic, account, errorMessage);
	await waitForFinalization;
}
