<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		loadCategoryForumPostsIncremental,
		saveForumPost,
		type ForumPost,
		type LoadedContent
	} from '$lib/services/content';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import {
		loadTrustedAccountSummary,
		type TrustedAccountSummary
	} from '$lib/services/trusted-accounts';
	import { PUBLISH_NOTICE_PREPARING } from '$lib/services/publish-notices';

	let { category }: { category: LoadedContent } = $props();

	let posts: ForumPost[] = $state([]);
	let error = $state('');
	let notice = $state('');
	let saving = $state(false);
	let loading = $state(false);
	let draft = $state({ title: '', body: '' });
	let requestId = 0;
	let postAuthors = $state<Record<string, TrustedAccountSummary>>({});

	$effect(() => {
		void category.itemIdHex;
		if (!connections.ipfsConnected || category.contentType !== 'category') return;
		error = '';
		notice = '';
		void refreshPosts();
	});

	async function refreshPosts() {
		if (!connections.ipfsConnected || category.contentType !== 'category') return;
		const currentRequestId = ++requestId;
		posts = [];
		postAuthors = {};
		loading = true;
		try {
			await loadCategoryForumPostsIncremental({
				api: connections.api,
				category,
				onPost: (post) => {
					if (currentRequestId !== requestId) return;
					posts = [...posts, post].sort((a, b) => a.title.localeCompare(b.title));
					void loadPostAuthor(post, currentRequestId);
				}
			});
		} catch (value) {
			if (currentRequestId === requestId)
				error = value instanceof Error ? value.message : String(value);
		} finally {
			if (currentRequestId === requestId) loading = false;
		}
	}

	async function loadPostAuthor(post: ForumPost, currentRequestId: number) {
		if (!connections.api || !post.ownerHex) return;
		try {
			const summary = await loadTrustedAccountSummary(connections.api, post.ownerHex);
			if (currentRequestId !== requestId) return;
			postAuthors = {
				...postAuthors,
				[post.itemIdHex]: summary
			};
		} catch {
			// Ignore missing profile metadata and fall back to a placeholder avatar.
		}
	}

	function authorLabel(post: ForumPost): string {
		const displayName = postAuthors[post.itemIdHex]?.displayName?.trim() ?? '';
		return displayName.replace(/'s account$/i, '').trim() || displayName || 'Unknown author';
	}

	function authorInitial(post: ForumPost): string {
		return (authorLabel(post)[0] ?? post.title.trim()[0] ?? '?').toUpperCase();
	}

	async function addPost() {
		if (!connections.api || !connections.ipfsConnected || !injectedAccounts.activeAccount) return;
		error = '';
		notice = '';
		saving = true;
		try {
			notice = PUBLISH_NOTICE_PREPARING;
			const post = await saveForumPost({
				api: connections.api,
				account: injectedAccounts.activeAccount,
				categoryItemIdHex: category.itemIdHex,
				draft
			});
			await goto(resolve(`/item_id/${encodeURIComponent(post.itemIdHex)}`));
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
		<p class="text-sm text-surface-700-300">
			{posts.length} post{posts.length === 1 ? '' : 's'}{loading ? ' loading…' : ''}
		</p>
	</div>

	{#if error}
		<div class="mt-4 card border-red-500/40 px-3 py-2 text-sm text-red-200">{error}</div>
	{/if}
	{#if notice}
		<div class="mt-4 card border-green-500/40 px-3 py-2 text-sm text-green-200">{notice}</div>
	{/if}

	{#if injectedAccounts.activeAccount}
		<form
			class="mt-4 space-y-3 card p-4"
			onsubmit={(event) => {
				event.preventDefault();
				void addPost();
			}}
		>
			<h4 class="font-semibold">Create post</h4>
			<input
				class="input w-full"
				bind:value={draft.title}
				placeholder="Post title"
				disabled={saving}
				required
			/>
			<textarea
				class="textarea min-h-32 w-full"
				bind:value={draft.body}
				placeholder="Post body"
				disabled={saving}
				required
			></textarea>
			<button
				class="variant-filled btn"
				type="submit"
				disabled={saving || !connections.ipfsConnected || !draft.title.trim() || !draft.body.trim()}
				>{saving ? 'Publishing…' : 'Publish post'}</button
			>
		</form>
	{:else}
		<p class="mt-4 text-sm text-surface-700-300">Connect an account to create a post.</p>
	{/if}

	<div class="mt-4 space-y-3">
		{#each posts as post (post.itemIdHex)}
			{@const author = postAuthors[post.itemIdHex]}
			<article class="card p-4">
				<div class="flex items-center gap-3">
					{#if author?.imagePreviewDataUrl}
						<img
							src={author.imagePreviewDataUrl}
							alt={`${authorLabel(post)} profile picture`}
							class="h-12 w-12 flex-none rounded-lg object-cover"
						/>
					{:else}
						<div
							class="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-surface-200-800 text-sm font-semibold text-surface-700-300"
							aria-hidden="true"
						>
							{authorInitial(post)}
						</div>
					{/if}
					<div class="min-w-0">
						<a
							class="block text-lg font-semibold hover:underline"
							href={resolve(`/item_id/${encodeURIComponent(post.itemIdHex)}`)}
						>
							{post.title || 'Untitled post'}
						</a>
						{#if author?.profileItemIdHex}
							<p class="mt-1 text-sm text-surface-700-300">
								by
								<a
									class="ml-1 hover:underline"
									href={resolve(`/item_id/${encodeURIComponent(author.profileItemIdHex)}`)}
								>
									{authorLabel(post)}
								</a>
							</p>
						{/if}
					</div>
				</div>
			</article>
		{:else}
			<p class="text-surface-700-300 text-sm">{loading ? 'Loading posts…' : 'No posts found.'}</p>
		{/each}
	</div>
</div>
