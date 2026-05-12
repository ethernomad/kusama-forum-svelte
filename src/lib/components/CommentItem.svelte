<script lang="ts">
	import CommentForm from '$lib/components/CommentForm.svelte';
	import CommentItem from '$lib/components/CommentItem.svelte';
	import Reactions from '$lib/components/Reactions.svelte';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import {
		getSubscriptionDecodedEvent,
		itemIdIndexerKey,
		subscribeIndexerEvents
	} from '$lib/services/indexer.svelte';
	import {
		canEditContent,
		canRetractContent,
		fetchContentRevisions,
		loadContentByItemId,
		publishContentRevision,
		retractItem,
		type ContentRevisionMeta,
		type ForumComment
	} from '$lib/services/content';

	let { comment, onChanged }: { comment: ForumComment; onChanged: () => void | Promise<void> } =
		$props();

	let editOpen = $state(false);
	let editBody = $state('');
	let editSaving = $state(false);
	let retracting = $state(false);
	let editError = $state('');
	let revisions = $state<ContentRevisionMeta[]>([]);
	let selectedRevisionId = $state<number | null>(null);
	let viewedBody = $state('');
	let switchingRevision = $state(false);

	const commentTimestamp = $derived(
		comment.createdAtMs == null ? '—' : new Date(comment.createdAtMs).toLocaleString()
	);
	const canEdit = $derived(canEditContent(comment, injectedAccounts.activeAccount));
	const canRetract = $derived(canRetractContent(comment, injectedAccounts.activeAccount));
	const latestRevisionId = $derived(comment.latestRevisionId ?? comment.revisionId);
	const editUnchanged = $derived(editBody.trim() === comment.bodyText.trim());

	function toggleEdit() {
		editOpen = !editOpen;
		editError = '';
		if (editOpen) editBody = viewedBody;
	}

	async function selectRevision(revisionId: number) {
		selectedRevisionId = revisionId;
		if (revisionId === latestRevisionId) {
			viewedBody = comment.bodyText;
			return;
		}
		switchingRevision = true;
		try {
			const selected = await loadContentByItemId(comment.itemIdHex, connections.api, revisionId);
			viewedBody = selected.bodyText;
		} catch (value) {
			editError = value instanceof Error ? value.message : String(value);
		} finally {
			switchingRevision = false;
		}
	}

	async function saveEdit() {
		if (
			!connections.api ||
			!connections.ipfsConnected ||
			!injectedAccounts.activeAccount ||
			!canEdit
		) {
			return;
		}
		editError = '';
		editSaving = true;
		try {
			await publishContentRevision({
				api: connections.api,
				account: injectedAccounts.activeAccount,
				content: comment,
				draft: { title: comment.title, body: editBody }
			});
			editOpen = false;
			await onChanged();
		} catch (value) {
			editError = value instanceof Error ? value.message : String(value);
		} finally {
			editSaving = false;
		}
	}

	async function retractComment() {
		if (!connections.api || !injectedAccounts.activeAccount || !canRetract) return;
		editError = '';
		retracting = true;
		try {
			await retractItem(connections.api, injectedAccounts.activeAccount, comment.itemIdHex);
			editOpen = false;
			await onChanged();
		} catch (value) {
			editError = value instanceof Error ? value.message : String(value);
		} finally {
			retracting = false;
		}
	}

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
		let cancelled = false;
		void fetchContentRevisions(itemIdHex).then((next) => {
			if (!cancelled) revisions = next;
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		selectedRevisionId = latestRevisionId;
		viewedBody = comment.bodyText;
		editBody = comment.bodyText;
	});

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
	{#if editOpen}
		<form
			class="mt-3 space-y-3"
			onsubmit={(event) => {
				event.preventDefault();
				void saveEdit();
			}}
		>
			<label class="block space-y-2 text-sm font-semibold">
				<span>Edit comment</span>
				<textarea
					class="textarea min-h-24 w-full"
					bind:value={editBody}
					placeholder="Edit your comment…"
					disabled={editSaving}
					required
				></textarea>
			</label>
			{#if editError}<p class="text-sm text-red-300">{editError}</p>{/if}
			<div class="flex flex-wrap items-center gap-2">
				<button
					class="variant-filled btn"
					type="submit"
					disabled={editSaving || !connections.ipfsConnected || !editBody.trim() || editUnchanged}
					>{editSaving ? 'Saving…' : 'Save edit'}</button
				>
				<button class="variant-soft btn" type="button" disabled={editSaving} onclick={toggleEdit}
					>Cancel</button
				>
			</div>
		</form>
	{:else}
		<div class="mt-3 text-sm whitespace-pre-wrap">{viewedBody}</div>
	{/if}
	{#if revisions.length > 1}
		<label class="mt-3 block space-y-1 text-xs text-surface-700-300">
			<span>Comment revision</span>
			<select
				class="select max-w-xs"
				value={selectedRevisionId ?? ''}
				disabled={switchingRevision}
				onchange={(event) => {
					const revisionId = Number(event.currentTarget.value);
					if (Number.isFinite(revisionId)) void selectRevision(revisionId);
				}}
			>
				{#each revisions as revision (revision.revisionId)}
					<option value={revision.revisionId}>
						Revision {revision.revisionId}{revision.revisionId === latestRevisionId
							? ' (latest)'
							: ''}
					</option>
				{/each}
			</select>
		</label>
	{/if}
	{#if selectedRevisionId != null}
		<Reactions itemIdHex={comment.itemIdHex} revisionId={selectedRevisionId} />
	{/if}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#if canEdit}
			<button
				class="variant-soft btn-sm"
				type="button"
				onclick={toggleEdit}
				disabled={editSaving || retracting}
			>
				{editOpen ? 'Cancel edit' : 'Edit'}
			</button>
		{/if}
		{#if canRetract}
			<button
				class="variant-soft btn-sm"
				type="button"
				onclick={() => void retractComment()}
				disabled={editSaving || retracting}
			>
				{retracting ? 'Retracting…' : 'Retract'}
			</button>
		{/if}
	</div>
	<CommentForm parentItemIdHex={comment.itemIdHex} onPublished={onChanged} label="Reply" />
	{#if comment.replies.length}
		<div class="mt-4 space-y-3 border-l border-surface-300-700 pl-4">
			{#each comment.replies as reply (reply.itemIdHex)}
				<CommentItem comment={reply} {onChanged} />
			{/each}
		</div>
	{/if}
</article>
