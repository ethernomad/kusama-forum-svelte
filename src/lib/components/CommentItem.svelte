<script lang="ts">
	import CommentForm from '$lib/components/CommentForm.svelte';
	import CommentItem from '$lib/components/CommentItem.svelte';
	import Reactions from '$lib/components/Reactions.svelte';
	import {
		getSubscriptionDecodedEvent,
		itemIdIndexerKey,
		subscribeIndexerEvents
	} from '$lib/services/indexer.svelte';
	import { type ForumComment } from '$lib/services/content';

	let { comment, onChanged }: { comment: ForumComment; onChanged: () => void | Promise<void> } =
		$props();

	const commentTimestamp = $derived(
		comment.createdAtMs == null ? '—' : new Date(comment.createdAtMs).toLocaleString()
	);

	function handleIndexerMessage(
		message: Parameters<Parameters<typeof subscribeIndexerEvents>[1]>[0]
	) {
		const decoded = getSubscriptionDecodedEvent(message);
		if (decoded?.event.palletName !== 'Content') return;
		const eventName = decoded.event.eventName;
		if (eventName === 'PublishRevision' || eventName === 'PublishItem') void onChanged();
	}

	$effect(() => {
		const itemIdHex = comment.itemIdHex;
		const unsubscribe = subscribeIndexerEvents(itemIdIndexerKey(itemIdHex), handleIndexerMessage);
		return unsubscribe;
	});
</script>

<article class="rounded-lg border border-surface-200-800 bg-surface-100-900 p-4">
	<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-700-300">
		<span>{commentTimestamp}</span>
	</div>
	<div class="mt-3 text-sm whitespace-pre-wrap">{comment.bodyText}</div>
	{#if comment.latestRevisionId != null || comment.revisionId != null}
		<Reactions
			itemIdHex={comment.itemIdHex}
			revisionId={comment.latestRevisionId ?? comment.revisionId ?? 0}
		/>
	{/if}
	<CommentForm parentItemIdHex={comment.itemIdHex} onPublished={onChanged} label="Reply" />
	{#if comment.replies.length}
		<div class="mt-4 space-y-3 border-l border-surface-300-700 pl-4">
			{#each comment.replies as reply (reply.itemIdHex)}
				<CommentItem comment={reply} {onChanged} />
			{/each}
		</div>
	{/if}
</article>
