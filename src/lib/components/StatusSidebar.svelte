<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Navigation } from '@skeletonlabs/skeleton-svelte';
	import AccountSelector from '$lib/components/AccountSelector.svelte';
	import { connections } from '$lib/services/connections.svelte';

	type MenuHref = '/my-profile' | '/item_id' | '/create-forum';

	type MenuItem = {
		href?: MenuHref;
		label: string;
		description: string;
		action?: () => void;
	};

	const menuItems: MenuItem[] = [
		{
			href: '/my-profile',
			label: 'My profile',
			description: 'Edit your account profile and avatar'
		},
		{
			href: '/item_id',
			label: 'Item ID',
			description: 'Inspect any item by its on-chain ID'
		},
		{
			href: '/create-forum',
			label: 'Create forum',
			description: 'Publish a new top-level forum'
		},
		{
			label: 'Refresh page',
			description: 'Reload the app and reconnect services',
			action: () => location.reload()
		}
	];

	const isConnected = (status: string) =>
		status === 'Connected' || status.startsWith('Running in browser') || status.startsWith('Connected to global IPFS');
</script>

<div class="space-y-6 xl:sticky xl:top-6 xl:self-start">
	<AccountSelector />

	<Navigation
		layout="sidebar"
		class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-2 shadow-sm"
	>
		<Navigation.Content>
			<Navigation.Group class="space-y-1">
				{#each menuItems as item (item.href ?? item.label)}
					{#if item.href}
						<Navigation.TriggerAnchor
							href={resolve(item.href)}
							aria-current={page.url.pathname === item.href ? 'page' : undefined}
							class={[
								'block rounded-lg border px-3 py-3 transition-colors',
								page.url.pathname === item.href
									? 'border-primary-500/30 bg-primary-500/10'
									: 'border-transparent hover:bg-surface-100-900'
							]}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-sm font-medium">{item.label}</p>
									<p class="text-surface-700-300 mt-1 text-xs">{item.description}</p>
								</div>
								<span class="text-surface-700-300 text-xs">→</span>
							</div>
						</Navigation.TriggerAnchor>
					{:else}
						<button
							type="button"
							class="hover:bg-surface-100-900 block w-full rounded-lg border border-transparent px-3 py-3 text-left transition-colors"
							onclick={item.action}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-sm font-medium">{item.label}</p>
									<p class="text-surface-700-300 mt-1 text-xs">{item.description}</p>
								</div>
								<span class="text-surface-700-300 text-xs">↻</span>
							</div>
						</button>
					{/if}
				{/each}
			</Navigation.Group>
		</Navigation.Content>
	</Navigation>

	<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
		<div class="mb-4">
			<h2 class="text-sm font-medium">Status</h2>
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

			<a class="flex items-center justify-between gap-3 rounded-lg transition-colors hover:bg-surface-100-900/60" href={resolve('/status/ipfs')} aria-label="IPFS status page">
				<div class="flex items-center gap-3">
					<span class={`h-3 w-3 rounded-full ${isConnected(connections.ipfsStatus) ? 'bg-green-500' : 'bg-red-500'}`}></span>
					<span class="font-medium">IPFS</span>
				</div>
				<span class="text-surface-700-300">{connections.ipfsConnections}</span>
			</a>
		</div>
	</section>

</div>
