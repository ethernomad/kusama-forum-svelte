<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import { connections } from '$lib/services/connections.svelte';
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
				<p><span class="font-medium">Endpoint:</span> {connections.endpoint}</p>
				<p><span class="font-medium">Status:</span> {connections.status}</p>
				{#if connections.chainName}
					<p><span class="font-medium">Chain:</span> {connections.chainName}</p>
				{/if}
				{#if connections.nodeName}
					<p><span class="font-medium">Node:</span> {connections.nodeName}</p>
				{/if}
				{#if connections.nodeVersion}
					<p><span class="font-medium">Version:</span> {connections.nodeVersion}</p>
				{/if}
				{#if connections.latestBlockNumber}
					<p><span class="font-medium">Latest block:</span> #{connections.latestBlockNumber}</p>
				{/if}
			</div>
		</div>

		<div class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
			<h2 class="mb-3 text-base font-medium">Indexer connection</h2>
			<div class="space-y-2 text-sm">
				<p><span class="font-medium">Endpoint:</span> {connections.indexerEndpoint}</p>
				<p><span class="font-medium">Status:</span> {connections.indexerStatus}</p>
				<p><span class="font-medium">Subscription:</span> {connections.indexerSubscriptionStatus}</p>
				{#if connections.indexerSubscriptionId}
					<p><span class="font-medium">Subscription ID:</span> {connections.indexerSubscriptionId}</p>
				{/if}
				{#if connections.indexerLatestBlockNumber}
					<p>
						<span class="font-medium">Latest indexed block:</span> #{connections.indexerLatestBlockNumber}
					</p>
				{/if}
				{#if connections.indexerLastUpdate}
					<p><span class="font-medium">Last update:</span> {connections.indexerLastUpdate}</p>
				{/if}
				{#if connections.indexerSpans.length > 0}
					<div>
						<p class="mb-2 font-medium">Indexed spans:</p>
						<ul class="list-disc space-y-1 pl-5">
							{#each connections.indexerSpans as span}
								<li>#{span.start} - #{span.end}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</div>

		<div class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
			<h2 class="mb-3 text-base font-medium">Browser IPFS node</h2>
			<div class="space-y-2 text-sm">
				<p><span class="font-medium">Status:</span> {connections.ipfsStatus}</p>
				{#if connections.ipfsPeerId}
					<p><span class="font-medium">Peer ID:</span> {connections.ipfsPeerId}</p>
				{/if}
				<p><span class="font-medium">Active connections:</span> {connections.ipfsConnections}</p>
				{#if connections.ipfsMultiaddrs.length > 0}
					<div>
						<p class="mb-2 font-medium">Listen addresses:</p>
						<ul class="list-disc space-y-1 pl-5 break-all">
							{#each connections.ipfsMultiaddrs as addr}
								<li>{addr}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</div>
	</section>
</main>
