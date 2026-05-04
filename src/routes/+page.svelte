<script lang="ts">
	import { AppBar, Menu } from '@skeletonlabs/skeleton-svelte';
	import {
		formatAccountLabel,
		formatShortAddress,
		injectedAccounts,
		loadInjectedAccounts,
		selectInjectedAccount
	} from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
</script>

<AppBar class="px-6">
	<div class="flex items-center justify-between gap-4 py-4">
		<div class="flex items-center gap-3">
			<span class="text-sm font-semibold">Kusama Forum</span>
			<span class="text-surface-700-300 text-sm">Substrate endpoint demo</span>
		</div>

		<Menu positioning={{ placement: 'bottom-end' }}>
			<Menu.Trigger
				class="border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900 inline-flex min-w-56 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
			>
				<div class="min-w-0">
					<p class="truncate font-medium">{formatAccountLabel(injectedAccounts.activeAccount)}</p>
					<p class="text-surface-700-300 truncate text-xs">
						{#if injectedAccounts.activeAccount}
							{formatShortAddress(injectedAccounts.activeAccount.address)}
						{:else}
							{injectedAccounts.status}
						{/if}
					</p>
				</div>
				<span aria-hidden="true" class="text-xs">▾</span>
			</Menu.Trigger>

			<Menu.Positioner>
				<Menu.Content class="border-surface-200-800 bg-surface-50-950 w-80 rounded-xl border p-1 shadow-xl">
					<div class="px-3 py-2">
						<p class="text-xs font-medium">Injected accounts</p>
						<p class="text-surface-700-300 mt-1 text-xs">{injectedAccounts.status}</p>
					</div>

					<Menu.Separator class="bg-surface-200-800 my-1 h-px border-0" />

					{#if injectedAccounts.accounts.length > 0}
						{#each injectedAccounts.accounts as account (account.address)}
							<Menu.Item
								value={account.address}
								onclick={() => selectInjectedAccount(account.address)}
								class="hover:bg-surface-100-900 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm outline-none"
							>
								<span class="w-4 text-center text-xs">
									{account.address === injectedAccounts.activeAddress ? '✓' : ''}
								</span>
								<div class="min-w-0 flex-1">
									<p class="truncate font-medium">{formatAccountLabel(account)}</p>
									<p class="text-surface-700-300 truncate text-xs">
										{formatShortAddress(account.address)}
									</p>
									<p class="text-surface-700-300 truncate text-xs">
										Source: {account.meta.source ?? 'unknown'}
									</p>
								</div>
							</Menu.Item>
						{/each}
					{:else}
						<div class="px-3 py-2 text-sm">Install or unlock the Polkadot.js extension to continue.</div>
					{/if}

					<Menu.Separator class="bg-surface-200-800 my-1 h-px border-0" />
					<Menu.Item
						value="refresh-accounts"
						onclick={() => loadInjectedAccounts()}
						class="hover:bg-surface-100-900 cursor-pointer rounded-lg px-3 py-2 text-sm outline-none"
					>
						Refresh accounts
					</Menu.Item>
				</Menu.Content>
			</Menu.Positioner>
		</Menu>
	</div>
</AppBar>

<main class="mx-auto max-w-3xl p-6">
	<section class="space-y-6">
		<div class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
			<h2 class="mb-3 text-base font-medium">Active account</h2>
			<div class="space-y-2 text-sm">
				<p><span class="font-medium">Status:</span> {injectedAccounts.status}</p>
				<p>
					<span class="font-medium">Extension connected:</span>
					{injectedAccounts.extensionEnabled ? 'Yes' : 'No'}
				</p>
				{#if injectedAccounts.activeAccount}
					<p>
						<span class="font-medium">Selected account:</span>
						{formatAccountLabel(injectedAccounts.activeAccount)}
					</p>
					<p><span class="font-medium">Address:</span> {injectedAccounts.activeAccount.address}</p>
					<p>
						<span class="font-medium">Source:</span>
						{injectedAccounts.activeAccount.meta.source ?? 'unknown'}
					</p>
				{:else}
					<p>No injected account selected.</p>
				{/if}
			</div>
		</div>

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
