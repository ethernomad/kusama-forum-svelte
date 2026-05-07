<script lang="ts">
	import CommentForm from '$lib/components/CommentForm.svelte';
	import CommentItem from '$lib/components/CommentItem.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { loadCommentTree, type ForumComment, type LoadedContent } from '$lib/services/content';
	import { getSubscriptionDecodedEvent, itemIdIndexerKey, subscribeIndexerEvents } from '$lib/services/indexer.svelte';

	let { item, refreshNonce = 0 }: { item: LoadedContent; refreshNonce?: number } = $props();

	let comments: ForumComment[] = $state([]);
	let loading = $state(false);
	let error = $state('');
	let requestId = 0;

	$effect(() => {
		void item.itemIdHex;
		void refreshNonce;
		if (!connections.heliaNode) return;
		void refresh();
	});

	$effect(() => {
		const parentItemIdHex = item.itemIdHex;
		const unsubscribe = subscribeIndexerEvents(itemIdIndexerKey(parentItemIdHex), (message) => {
			const decoded = getSubscriptionDecodedEvent(message);
			if (decoded?.event.palletName === 'Content' && decoded.event.eventName === 'PublishItem') {
				void refresh();
			}
		});
		return unsubscribe;
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
			<CommentItem {comment} onChanged={refresh} />
		{:else}
			<p class="text-sm text-surface-700-300">{loading ? 'Loading comments…' : 'No comments yet.'}</p>
		{/each}
	</div>
</section>
