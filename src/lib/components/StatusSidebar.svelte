<script lang="ts">
	import AccountSelector from '$lib/components/AccountSelector.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { ipfsPinningQueue } from '$lib/services/ipfs-pinning-queue.svelte';
	import { ipfsProvideStatus } from '$lib/services/ipfs-provide-status.svelte';

	const isConnected = (status: string) =>
		status === 'Connected' || status.startsWith('Running in browser') || status.startsWith('Connected to global IPFS');

	const pendingPinCount = $derived.by(() =>
		ipfsPinningQueue.entries.filter((entry) => entry.status === 'queued' || entry.status === 'sending' || entry.status === 'failed').length
	);

	const ipfsProvideMessage = $derived.by(() => {
		if (ipfsProvideStatus.pending > 0) {
			return `Advertising ${ipfsProvideStatus.pending} IPFS item${ipfsProvideStatus.pending === 1 ? '' : 's'}...`;
		}
		if (ipfsProvideStatus.lastError) {
			return `IPFS advertisement failed: ${ipfsProvideStatus.lastError}`;
		}
		if (ipfsProvideStatus.lastCompletedAt) {
			return `Last IPFS advertisement completed at ${new Date(ipfsProvideStatus.lastCompletedAt).toLocaleTimeString()}.`;
		}
		return 'Idle.';
	});
</script>

<div class="space-y-6 xl:sticky xl:top-6 xl:self-start">
	<AccountSelector />

	<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
		<div class="mb-4 space-y-2">
			<a class="btn variant-outline w-full justify-start" href="/my-profile">My profile</a>
			<a class="btn variant-outline w-full justify-start" href="/item_id">Item ID</a>
			<a class="btn variant-outline w-full justify-start" href="/create-forum">Create forum</a>
			<a class="btn variant-outline w-full justify-start" href="/status">Status</a>
			<button class="btn variant-outline w-full justify-start" type="button" onclick={() => location.reload()}>Refresh page</button>
		</div>
		<div class="space-y-3 text-sm">
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<span class={`h-3 w-3 rounded-full ${isConnected(connections.status) ? 'bg-green-500' : 'bg-red-500'}`}></span>
					<span class="font-medium">Chain</span>
				</div>
				<span class="text-surface-700-300">{#if connections.latestBlockNumber}#{connections.latestBlockNumber}{:else}—{/if}</span>
			</div>

			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<span class={`h-3 w-3 rounded-full ${isConnected(connections.indexerStatus) ? 'bg-green-500' : 'bg-red-500'}`}></span>
					<span class="font-medium">Indexer</span>
				</div>
				<span class="text-surface-700-300">{#if connections.indexerLatestBlockNumber}#{connections.indexerLatestBlockNumber}{:else}—{/if}</span>
			</div>

			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<span class={`h-3 w-3 rounded-full ${isConnected(connections.ipfsStatus) ? 'bg-green-500' : 'bg-red-500'}`}></span>
					<span class="font-medium">IPFS</span>
				</div>
				<span class="text-surface-700-300">{connections.ipfsConnections}</span>
			</div>
		</div>
	</section>

	<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4 text-sm">
		<h2 class="mb-2 text-base font-medium">Profile status</h2>
		<p class="text-surface-700-300">Profiles are encoded as the same protobuf item payload used by acuity-dioxus before publishing to IPFS and the chain.</p>
		<p class={`mt-3 text-xs ${ipfsProvideStatus.lastError ? 'text-red-300' : 'text-surface-700-300'}`}>{ipfsProvideMessage}</p>
		<p class="mt-2 text-xs text-surface-700-300">
			Pinner queue: {pendingPinCount} pending · {ipfsPinningQueue.entries.filter((entry) => entry.status === 'acked').length} acked
		</p>
		{#if connections.ipfsLastLocalDialError}
			<p class="mt-2 text-xs text-red-300">Local Kubo dial error: {connections.ipfsLastLocalDialError}</p>
		{/if}

		<div class="mt-4 space-y-2">
			<h3 class="text-xs font-medium uppercase tracking-wide text-surface-700-300">Helia swarm targets</h3>
			{#if connections.ipfsSwarmAddresses.length > 0}
				<ul class="space-y-2 text-xs break-all">
					{#each connections.ipfsSwarmAddresses as address}
						<li class="rounded-lg border border-surface-200-800 bg-surface-100-900 px-2 py-1">
							<div class="flex items-start justify-between gap-2">
								<span class="font-mono">{address}</span>
								<span class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${connections.ipfsConnectedAddresses.includes(address) ? 'bg-green-500/15 text-green-300' : 'bg-surface-200-800 text-surface-700-300'}`}>
									{connections.ipfsConnectedAddresses.includes(address) ? 'connected' : 'dialing'}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-surface-700-300">No Helia swarm addresses configured.</p>
			{/if}
		</div>
	</section>
</div>
