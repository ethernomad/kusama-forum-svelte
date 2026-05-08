<script lang="ts">
	import AccountSelector from '$lib/components/AccountSelector.svelte';
	import { connections } from '$lib/services/connections.svelte';

	const isConnected = (status: string) =>
		status === 'Connected' || status.startsWith('Running in browser') || status.startsWith('Connected to global IPFS');
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

</div>
