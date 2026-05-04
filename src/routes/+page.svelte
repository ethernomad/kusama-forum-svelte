<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiPromise, WsProvider } from '@polkadot/api';
	import { AppBar } from '@skeletonlabs/skeleton-svelte';

	const ENDPOINT = 'ws://127.0.0.1:9944';

	let status = $state('Connecting...');
	let chainName = $state('');
	let nodeName = $state('');
	let nodeVersion = $state('');
	let latestBlockNumber = $state<string>('');
	let api = $state<ApiPromise | null>(null);

	onMount(() => {
		let active = true;
		let unsubscribeNewHeads: (() => void) | undefined;
		let connectedApi: ApiPromise | null = null;

		void (async () => {
			try {
				const provider = new WsProvider(ENDPOINT);
				connectedApi = await ApiPromise.create({ provider });
				await connectedApi.isReady;

				const [runtimeChain, runtimeNode, runtimeVersion] = await Promise.all([
					connectedApi.rpc.system.chain(),
					connectedApi.rpc.system.name(),
					connectedApi.rpc.system.version()
				]);

				unsubscribeNewHeads = await connectedApi.rpc.chain.subscribeNewHeads((header) => {
					if (!active) return;
					latestBlockNumber = header.number.toString();
				});

				if (!active) {
					unsubscribeNewHeads?.();
					void connectedApi.disconnect();
					return;
				}

				api = connectedApi;
				chainName = runtimeChain.toString();
				nodeName = runtimeNode.toString();
				nodeVersion = runtimeVersion.toString();
				status = 'Connected';
			} catch (error) {
				status = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
			}
		})();

		return () => {
			active = false;
			unsubscribeNewHeads?.();
			void connectedApi?.disconnect();
		};
	});
</script>

<AppBar class="px-6">
	<div class="flex items-center gap-3 py-4">
		<span class="text-sm font-semibold">Kusama Forum</span>
		<span class="text-surface-700-300 text-sm">Substrate endpoint demo</span>
	</div>
</AppBar>

<main class="mx-auto max-w-3xl p-6">
	<section class="space-y-6">
		<div class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
			<h2 class="mb-3 text-base font-medium">Substrate connection</h2>
			<div class="space-y-2 text-sm">
				<p><span class="font-medium">Endpoint:</span> {ENDPOINT}</p>
				<p><span class="font-medium">Status:</span> {status}</p>
				{#if chainName}
					<p><span class="font-medium">Chain:</span> {chainName}</p>
				{/if}
				{#if nodeName}
					<p><span class="font-medium">Node:</span> {nodeName}</p>
				{/if}
				{#if nodeVersion}
					<p><span class="font-medium">Version:</span> {nodeVersion}</p>
				{/if}
				{#if latestBlockNumber}
					<p><span class="font-medium">Latest block:</span> #{latestBlockNumber}</p>
				{/if}
			</div>
		</div>
	</section>
</main>
