<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatShortAddress, injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { saveForum, type ForumDraft } from '$lib/services/content';

	let draft: ForumDraft = $state({
		title: '',
		description: ''
	});
	let saving = $state(false);
	let error = $state('');
	let notice = $state('');

	const activeAccount = $derived(injectedAccounts.activeAccount);

	async function submitForum() {
		error = '';
		notice = '';

		if (!activeAccount) {
			error = 'Select an account before creating a forum.';
			return;
		}
		if (!connections.api) {
			error = 'Connect to the chain before creating a forum.';
			return;
		}
		if (!connections.heliaNode) {
			error = 'Start the in-browser Helia node before creating a forum.';
			return;
		}
		if (!connections.ipfsHasRequiredLocalConnection) {
			error = 'Publishing requires a connection to the local IPFS pinner on one of the default local swarm addresses.';
			return;
		}
		if (!draft.title.trim()) {
			error = 'Forum title is required.';
			return;
		}

		saving = true;
		notice = 'Publishing to IPFS, waiting for local pinner ACK, then opening the transaction...';
		try {
			const saved = await saveForum({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: activeAccount,
				draft
			});
			notice = 'Forum created successfully. Redirecting...';
			await goto(`/${saved.itemIdHex}`);
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

<div class="max-w-4xl space-y-6">
	<header class="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-surface-200-800 p-6">
		<div>
			<p class="text-surface-700-300 text-sm font-medium">Top-level content item</p>
			<h1 class="mt-1 text-2xl font-semibold">Create a forum</h1>
			<p class="text-surface-700-300 mt-2 max-w-2xl text-sm">
				Anyone can create a forum content item. The item is published to IPFS and then to the chain.
			</p>
		</div>
		<div class="flex gap-3">
			<a class="btn variant-outline" href="/my-profile">My profile</a>
		</div>
	</header>

	{#if error}
		<div class="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
	{:else if notice}
		<div class="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>
	{/if}

	<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-6">
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div class="space-y-4">
				<label class="block space-y-2 text-sm">
					<span class="font-medium">Forum title</span>
					<input class="w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={draft.title} placeholder="Kusama Governance" disabled={saving} />
				</label>

				<label class="block space-y-2 text-sm">
					<span class="font-medium">Description</span>
					<textarea class="min-h-48 w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={draft.description} placeholder="What is this forum about?" disabled={saving}></textarea>
				</label>

				<div class="flex flex-wrap gap-3">
					<button class="btn variant-filled-primary" onclick={submitForum} disabled={!activeAccount || !connections.api || !connections.heliaNode || !connections.ipfsHasRequiredLocalConnection || saving}>
						{#if saving}
							Creating...
						{:else}
							Create forum
						{/if}
					</button>
					<a class="btn variant-outline" href="/my-profile">Cancel</a>
				</div>
			</div>

			<aside class="space-y-4 rounded-xl border border-surface-200-800 p-4">
				<p class="text-sm font-medium">Preview</p>
				<div>
					<h2 class="text-lg font-semibold">{draft.title.trim() || 'Untitled forum'}</h2>
					<p class="text-surface-700-300 mt-2 text-sm whitespace-pre-wrap">{draft.description.trim() || 'No description yet.'}</p>
				</div>
				<div class="text-surface-700-300 space-y-1 text-xs">
					<p>Author: {activeAccount ? formatShortAddress(activeAccount.address) : 'No account selected'}</p>
					<p>{connections.ipfsHasRequiredLocalConnection ? 'Ready to publish through the local IPFS pinner.' : 'Connect to the local IPFS pinner before publishing.'}</p>
				</div>
			</aside>
		</div>
	</section>
</div>
