<script lang="ts">
	import { connections } from '$lib/services/connections.svelte';
</script>

<div class="max-w-5xl space-y-6">
	<header class="card border-dashed p-6">
		<p class="text-sm font-medium text-surface-700-300">Local daemon</p>
		<h1 class="mt-1 text-2xl font-semibold">IPFS status</h1>
		<p class="mt-2 text-sm text-surface-700-300">
			This app talks directly to the local Kubo API instead of running an in-browser Helia node.
		</p>
	</header>

	{#if connections.ipfsLastError}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">
			{connections.ipfsLastError}
		</div>
	{/if}

	<section class="grid gap-4 lg:grid-cols-2">
		<div class="space-y-3 card p-4">
			<h2 class="text-base font-medium">Connection</h2>
			<div class="text-sm text-surface-700-300">
				<p><span class="font-medium text-white">API URL:</span> {connections.ipfsApiUrl}</p>
				<p><span class="font-medium text-white">Status:</span> {connections.ipfsStatus}</p>
				<p>
					<span class="font-medium text-white">Agent:</span>
					{connections.ipfsAgentVersion || '—'}
				</p>
				<p>
					<span class="font-medium text-white">Protocol:</span>
					{connections.ipfsProtocolVersion || '—'}
				</p>
			</div>
		</div>

		<div class="space-y-3 card p-4">
			<h2 class="text-base font-medium">Identity</h2>
			<div class="space-y-2 text-sm text-surface-700-300">
				<p><span class="font-medium text-white">Peer ID:</span></p>
				<code class="block text-xs break-all">{connections.ipfsPeerId || 'Unavailable'}</code>
				<p><span class="font-medium text-white">Public key:</span></p>
				<code class="block text-xs break-all">{connections.ipfsPublicKey || 'Unavailable'}</code>
			</div>
		</div>
	</section>

	<section class="card p-4">
		<div class="mb-3 flex items-center justify-between gap-3">
			<h2 class="text-base font-medium">Advertised addresses</h2>
			<span class="text-xs text-surface-700-300">{connections.ipfsAddresses.length} endpoints</span>
		</div>
		{#if connections.ipfsAddresses.length === 0}
			<p class="text-sm text-surface-700-300">No daemon addresses reported yet.</p>
		{:else}
			<ul class="space-y-2 text-xs break-all">
				{#each connections.ipfsAddresses as address (address)}
					<li
						class="rounded-lg border border-surface-200-800 bg-surface-100-900 px-3 py-2 font-mono"
					>
						{address}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card p-4">
		<div class="mb-3 flex items-center justify-between gap-3">
			<h2 class="text-base font-medium">Supported protocols</h2>
			<span class="text-xs text-surface-700-300">{connections.ipfsProtocols.length} entries</span>
		</div>
		{#if connections.ipfsProtocols.length === 0}
			<p class="text-sm text-surface-700-300">No daemon protocols reported yet.</p>
		{:else}
			<ul class="space-y-2 text-xs break-all">
				{#each connections.ipfsProtocols as protocol (protocol)}
					<li
						class="rounded-lg border border-surface-200-800 bg-surface-100-900 px-3 py-2 font-mono"
					>
						{protocol}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
