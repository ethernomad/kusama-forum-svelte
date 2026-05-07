<script lang="ts">
	import CommentForm from '$lib/components/CommentForm.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { loadCommentTree, shortHex, type ForumComment, type LoadedContent } from '$lib/services/content';

	let { item }: { item: LoadedContent } = $props();

	let comments: ForumComment[] = $state([]);
	let loading = $state(false);
	let error = $state('');
	let requestId = 0;

	$effect(() => {
		void item.itemIdHex;
		if (!connections.heliaNode) return;
		void refresh();
	});

	async function refresh() {
		if (!connections.heliaNode) return;
		const currentRequestId = ++requestId;
		loading = true;
		error = '';
		try {
			const next = await loadCommentTree({
				heliaNode: connections.heliaNode,
				api: connections.api,
				parentItemIdHex: item.itemIdHex
			});
			if (currentRequestId === requestId) comments = next;
		} catch (value) {
			if (currentRequestId === requestId) error = value instanceof Error ? value.message : String(value);
		} finally {
			if (currentRequestId === requestId) loading = false;
		}
	}
</script>

{#snippet commentNode(comment: ForumComment)}
	<article class="rounded-lg border border-surface-200-800 bg-surface-100-900 p-4">
		<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-700-300">
			<span>Comment {shortHex(comment.itemIdHex)}</span>
			<span>Block {comment.publishBlockNumber || '—'}</span>
		</div>
		<div class="mt-3 whitespace-pre-wrap text-sm">{comment.bodyText}</div>
		<CommentForm parentItemIdHex={comment.itemIdHex} onPublished={refresh} label="Reply" />
		{#if comment.replies.length}
			<div class="mt-4 space-y-3 border-l border-surface-300-700 pl-4">
				{#each comment.replies as reply (reply.itemIdHex)}
					{@render commentNode(reply)}
				{/each}
			</div>
		{/if}
	</article>
{/snippet}

<section class="mt-8 border-t border-surface-200-800 pt-6">
	<div class="flex items-center justify-between gap-3">
		<h3 class="text-xl font-semibold">Comments</h3>
		<p class="text-sm text-surface-700-300">{comments.length} top-level comment{comments.length === 1 ? '' : 's'}{loading ? ' loading…' : ''}</p>
	</div>

	<CommentForm parentItemIdHex={item.itemIdHex} onPublished={refresh} />

	{#if error}
		<div class="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
	{/if}

	<div class="mt-4 space-y-3">
		{#each comments as comment (comment.itemIdHex)}
			{@render commentNode(comment)}
		{:else}
			<p class="text-sm text-surface-700-300">{loading ? 'Loading comments…' : 'No comments yet.'}</p>
		{/each}
	</div>
</section>
