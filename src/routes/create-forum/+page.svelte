<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatShortAddress, injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { saveForum, type ForumDraft } from '$lib/services/content';
	import { PUBLISH_NOTICE_PREPARING } from '$lib/services/publish-notices';

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
		notice = PUBLISH_NOTICE_PREPARING;
		try {
			const saved = await saveForum({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: activeAccount,
				draft
			});
			notice = 'Forum created successfully. Redirecting...';
			await goto(resolve(`/item_id/${saved.itemIdHex}`));
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

<div class="max-w-4xl space-y-6">
	<header class="card mb-6 flex flex-wrap items-start justify-between gap-4 border-dashed p-6">
		<div>
			<p class="text-surface-700-300 text-sm font-medium">Top-level content item</p>
			<h1 class="mt-1 text-2xl font-semibold">Create a forum</h1>
			<p class="text-surface-700-300 mt-2 max-w-2xl text-sm">
				Anyone can create a forum content item. The item is published to IPFS and then to the chain.
			</p>
		</div>
	</header>

	{#if error}
		<div class="card mb-6 border-red-500/40 px-4 py-3 text-sm text-red-200">{error}</div>
	{:else if notice}
		<div class="card mb-6 border-emerald-500/40 px-4 py-3 text-sm text-emerald-200">{notice}</div>
	{/if}

	<section class="card p-6">
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div class="space-y-4">
				<label class="block space-y-2 text-sm">
					<span class="font-medium">Forum title</span>
					<input class="input w-full" bind:value={draft.title} placeholder="Kusama Governance" disabled={saving} />
				</label>

				<label class="block space-y-2 text-sm">
					<span class="font-medium">Description</span>
					<textarea class="textarea min-h-48 w-full" bind:value={draft.description} placeholder="What is this forum about?" disabled={saving}></textarea>
				</label>

				<div class="flex flex-wrap gap-3">
					<button class="btn variant-filled-primary" onclick={submitForum} disabled={!activeAccount || !connections.api || !connections.heliaNode || !connections.ipfsHasRequiredLocalConnection || saving}>
						{#if saving}
							Creating...
						{:else}
							Create forum
						{/if}
					</button>
				</div>
			</div>

			<aside class="card space-y-4 p-4">
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
