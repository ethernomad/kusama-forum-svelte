import type { InjectedAccount } from './accounts.svelte';

function logPublishStep(message: string, details?: Record<string, unknown>): void {
	if (details) {
		console.log(`[publish] ${message}`, details);
		return;
	}
	console.log(`[publish] ${message}`);
}

export type SignableExtrinsic = {
	signAndSend: Function;
};

type SubmissionResult = {
	status: {
		isReady?: boolean;
		isBroadcast?: boolean;
		isInBlock?: boolean;
		isFinalized?: boolean;
		type?: string;
		toString?: () => string;
	};
	dispatchError?: unknown;
};

export async function signAndSubmit(
	extrinsic: SignableExtrinsic,
	account: InjectedAccount,
	errorMessage = 'Transaction failed on chain.'
): Promise<{ waitForInBlock: Promise<void> }> {
	if (typeof window === 'undefined') {
		throw new Error('Signing is only available in the browser.');
	}
	logPublishStep('Initializing chain signing', { account: account.address });
	const { web3FromSource } = await import('@polkadot/extension-dapp');
	const injector = await web3FromSource(String(account.meta.source ?? ''));

	let settledSubmission = false;
	let inBlockSettled = false;
	let unsubscribe: (() => void) | undefined;
	let resolveInBlock!: () => void;
	let rejectInBlock!: (reason?: unknown) => void;

	const waitForInBlock = new Promise<void>((resolve, reject) => {
		resolveInBlock = resolve;
		rejectInBlock = reject;
	});

	await new Promise<void>((resolveSubmission, rejectSubmission) => {
		logPublishStep('Requesting wallet signature and publishing transaction', { account: account.address });
		const fail = (error: unknown) => {
			unsubscribe?.();
			const failure = error instanceof Error ? error : new Error(String(error));
			console.error('signAndSubmit failed', failure);
			logPublishStep('Transaction submission failed', { account: account.address, error: failure.message });
			if (!settledSubmission) {
				settledSubmission = true;
				rejectSubmission(failure);
			}
			if (!inBlockSettled) {
				inBlockSettled = true;
				rejectInBlock(failure);
			}
		};

		void extrinsic
			.signAndSend(
				account.address,
				{ signer: injector.signer },
				(result: SubmissionResult) => {
					logPublishStep('Received transaction status update', {
						account: account.address,
						status: result.status?.type ?? result.status?.toString?.() ?? 'unknown',
						isReady: Boolean(result.status?.isReady),
						isBroadcast: Boolean(result.status?.isBroadcast),
						isInBlock: Boolean(result.status?.isInBlock),
						isFinalized: Boolean(result.status?.isFinalized)
					});
					if (result.dispatchError) {
						fail(new Error(errorMessage));
						return;
					}
					if (!settledSubmission && (result.status?.isReady || result.status?.isBroadcast)) {
						logPublishStep('Transaction published to the node', {
							account: account.address,
							status: result.status?.type ?? result.status?.toString?.() ?? 'unknown'
						});
						settledSubmission = true;
						resolveSubmission();
					}
					if (result.status?.isInBlock) {
						logPublishStep('Transaction included in block', { account: account.address });
						unsubscribe?.();
						if (!settledSubmission) {
							settledSubmission = true;
							resolveSubmission();
						}
						if (!inBlockSettled) {
							inBlockSettled = true;
							resolveInBlock();
						}
					}
				}
			)
			.then((unsub: () => void) => {
				unsubscribe = unsub;
			})
			.catch(fail);
	});

	logPublishStep('Wallet signature accepted; transaction publish handle ready', { account: account.address });
	return { waitForInBlock };
}
