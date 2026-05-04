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

	const isConnected = (status: string) => status === 'Connected' || status === 'Running in browser';
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

<main class="mx-auto max-w-7xl p-6">
	<div class="flex flex-col gap-6 lg:flex-row">
		<aside class="w-full lg:sticky lg:top-6 lg:w-48 lg:self-start">
			<section>
				<div class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
					<h2 class="mb-3 text-base font-medium">Connections</h2>
					<div class="space-y-3 text-sm">
						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-3">
								<span
									class={`h-3 w-3 rounded-full ${isConnected(connections.status) ? 'bg-green-500' : 'bg-red-500'}`}
								></span>
								<span class="font-medium">Chain</span>
							</div>
							<span class="text-surface-700-300">
								{#if connections.latestBlockNumber}#{connections.latestBlockNumber}{:else}—{/if}
							</span>
						</div>

						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-3">
								<span
									class={`h-3 w-3 rounded-full ${isConnected(connections.indexerStatus) ? 'bg-green-500' : 'bg-red-500'}`}
								></span>
								<span class="font-medium">Indexer</span>
							</div>
							<span class="text-surface-700-300">
								{#if connections.indexerLatestBlockNumber}#{connections.indexerLatestBlockNumber}{:else}—{/if}
							</span>
						</div>

						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-3">
								<span
									class={`h-3 w-3 rounded-full ${isConnected(connections.ipfsStatus) ? 'bg-green-500' : 'bg-red-500'}`}
								></span>
								<span class="font-medium">IPFS</span>
							</div>
							<span class="text-surface-700-300">{connections.ipfsConnections}</span>
						</div>
					</div>
				</div>
			</section>
		</aside>

		<section class="min-w-0 flex-1 rounded-xl border border-dashed border-surface-200-800 p-6 text-sm text-surface-700-300">
			<p class="font-medium text-surface-950-50">Forum workspace</p>
			<p class="mt-2">
				Connection details now live in the left sidebar. Use the account menu in the header to switch active accounts.
			</p>
		</section>
	</div>
</main>
