<script lang="ts">
	import { goto } from '$app/navigation';
	import { loadCategoryForumPostsIncremental, saveForumPost, type ForumPost, type LoadedContent } from '$lib/services/content';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { PUBLISH_NOTICE_PREPARING } from '$lib/services/publish-notices';

	let { category }: { category: LoadedContent } = $props();

	let posts: ForumPost[] = $state([]);
	let error = $state('');
	let notice = $state('');
	let saving = $state(false);
	let loading = $state(false);
	let draft = $state({ title: '', body: '' });
	let requestId = 0;

	$effect(() => {
		void category.itemIdHex;
		if (!connections.heliaNode || category.contentType !== 'category') return;
		error = '';
		notice = '';
		void refreshPosts();
	});

	async function refreshPosts() {
		if (!connections.heliaNode || category.contentType !== 'category') return;
		const currentRequestId = ++requestId;
		posts = [];
		loading = true;
		try {
			await loadCategoryForumPostsIncremental({
				heliaNode: connections.heliaNode,
				api: connections.api,
				category,
				onPost: (post) => {
					if (currentRequestId !== requestId) return;
					posts = [...posts, post].sort((a, b) => a.title.localeCompare(b.title));
				}
			});
		} catch (value) {
			if (currentRequestId === requestId) error = value instanceof Error ? value.message : String(value);
		} finally {
			if (currentRequestId === requestId) loading = false;
		}
	}

	async function addPost() {
		if (!connections.api || !connections.heliaNode || !injectedAccounts.activeAccount) return;
		error = '';
		notice = '';
		if (!connections.ipfsHasRequiredLocalConnection) {
			error = 'Publishing requires a connection to the local IPFS pinner on one of the default local swarm addresses.';
			return;
		}
		saving = true;
		try {
			notice = PUBLISH_NOTICE_PREPARING;
			const post = await saveForumPost({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: injectedAccounts.activeAccount,
				categoryItemIdHex: category.itemIdHex,
				draft
			});
			await goto(`/item_id/${encodeURIComponent(post.itemIdHex)}`);
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

<div class="mt-8 border-t border-surface-200-800 pt-6">
	<div class="flex items-center justify-between gap-3">
		<h3 class="text-xl font-semibold">Posts</h3>
		<p class="text-surface-700-300 text-sm">{posts.length} post{posts.length === 1 ? '' : 's'}{loading ? ' loading…' : ''}</p>
	</div>

	{#if error}
		<div class="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
	{/if}
	{#if notice}
		<div class="mt-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">{notice}</div>
	{/if}

	{#if injectedAccounts.activeAccount}
		<form class="mt-4 space-y-3 rounded-lg border border-surface-200-800 bg-surface-100-900 p-4" onsubmit={(event) => { event.preventDefault(); void addPost(); }}>
			<h4 class="font-semibold">Create post</h4>
			<input class="w-full rounded-lg border-surface-200-800 bg-surface-50-950" bind:value={draft.title} placeholder="Post title" disabled={saving} required />
			<textarea class="min-h-32 w-full rounded-lg border-surface-200-800 bg-surface-50-950" bind:value={draft.body} placeholder="Post body" disabled={saving} required></textarea>
			<button class="btn variant-filled" type="submit" disabled={saving || !connections.ipfsHasRequiredLocalConnection || !draft.title.trim() || !draft.body.trim()}>{saving ? 'Publishing…' : 'Publish post'}</button>
		</form>
	{:else}
		<p class="text-surface-700-300 mt-4 text-sm">Connect an account to create a post.</p>
	{/if}

	<div class="mt-4 space-y-3">
		{#each posts as post}
			<article class="rounded-lg border border-surface-200-800 bg-surface-100-900 p-4">
				<a class="text-lg font-semibold hover:underline" href={`/item_id/${encodeURIComponent(post.itemIdHex)}`}>{post.title || 'Untitled post'}</a>
			</article>
		{:else}
			<p class="text-surface-700-300 text-sm">{loading ? 'Loading posts…' : 'No posts found.'}</p>
		{/each}
	</div>
</div>
