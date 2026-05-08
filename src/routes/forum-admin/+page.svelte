<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatShortAddress, injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { bytesToHex, loadContentByItemId, type LoadedContent } from '$lib/services/content';

	let loading = $state(false);
	let error = $state('');
	let forums = $state<LoadedContent[]>([]);
	let refreshNonce = $state(0);
	let requestId = 0;

	const activeAccount = $derived(injectedAccounts.activeAccount);

	function normalizeItemId(value: unknown): string | null {
		if (typeof value === 'string' && value) return value.startsWith('0x') ? value : `0x${value}`;
		if (value instanceof Uint8Array) return bytesToHex(value);
		if (Array.isArray(value)) return bytesToHex(Uint8Array.from(value.map(Number)));
		return null;
	}

	$effect(() => {
		void refreshNonce;

		const account = activeAccount;
		const api = connections.api;
		const heliaNode = connections.heliaNode;

		if (!account || !api || !heliaNode) {
			forums = [];
			return;
		}

		const currentRequestId = ++requestId;
		loading = true;
		error = '';
		forums = [];

		const accountItemIds = (
			api.query as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
		).accountContent?.accountItemIds;

		if (!accountItemIds) {
			error = 'The account-content pallet query is not available in the connected runtime.';
			loading = false;
			return;
		}

		void accountItemIds(account.address)
			.then(async (storageValue) => {
				if (currentRequestId !== requestId) return;

				const raw = (storageValue as { toJSON?: () => unknown }).toJSON?.() ?? storageValue;
				const itemIds = Array.isArray(raw)
					? raw.map(normalizeItemId).filter((value): value is string => !!value)
					: [];

				const loaded = await Promise.all(
					itemIds.map((itemIdHex) =>
						loadContentByItemId(heliaNode, itemIdHex, api).catch(() => null)
					)
				);

				if (currentRequestId !== requestId) return;

				forums = loaded
					.filter((entry): entry is LoadedContent => !!entry)
					.filter((entry) => entry.contentType === 'forum')
					.sort((a, b) => a.title.localeCompare(b.title));
			})
			.catch((value) => {
				if (currentRequestId !== requestId) return;
				error = value instanceof Error ? value.message : String(value);
			})
			.finally(() => {
				if (currentRequestId !== requestId) return;
				loading = false;
			});
	});
</script>

<div class="max-w-5xl space-y-6">
	<header class="card flex flex-wrap items-start justify-between gap-4 border-dashed p-6">
		<div>
			<p class="text-surface-700-300 text-sm font-medium">Forum administration</p>
			<h1 class="mt-1 text-2xl font-semibold">My forums</h1>
			<p class="text-surface-700-300 mt-2 max-w-2xl text-sm">
				View the forums currently indexed in your on-chain account content list.
			</p>
		</div>

		<a class="btn variant-filled-primary" href={resolve('/create-forum')}>Create forum</a>
	</header>

	{#if !activeAccount}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">
			Select an account to view your forums.
		</div>
	{:else}
		<section class="card p-4 text-sm">
			<p class="font-medium">Active account</p>
			<p class="text-surface-700-300 mt-1">
				{formatShortAddress(activeAccount.address)}
			</p>
		</section>

		{#if error}
			<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">{error}</div>
		{:else if loading}
			<div class="card px-4 py-3 text-sm">Loading your forums…</div>
		{:else if forums.length === 0}
			<div class="card px-4 py-6 text-sm">
				<p class="font-medium">No forums found</p>
				<p class="text-surface-700-300 mt-2">
					This account does not currently have any forum items in account content.
				</p>
				<div class="mt-4">
					<a class="btn variant-outline" href={resolve('/create-forum')}>Create your first forum</a>
				</div>
			</div>
		{:else}
			<section class="space-y-4">
				{#each forums as forum (forum.itemIdHex)}
					<a
						class="card block p-5 transition hover:border-primary-500/50 hover:bg-surface-100/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
						href={resolve(`/item_id/${forum.itemIdHex}`)}
					>
						<div class="min-w-0">
							<h2 class="text-lg font-semibold">
								{forum.title || 'Untitled forum'}
							</h2>
							<p class="text-surface-700-300 mt-2 text-sm whitespace-pre-wrap">
								{forum.bodyText || 'No description.'}
							</p>
						</div>
					</a>
				{/each}
			</section>
		{/if}
	{/if}
</div>
