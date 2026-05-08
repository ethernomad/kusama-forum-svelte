<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import CategoryForumPosts from '$lib/components/CategoryForumPosts.svelte';
	import ContentTabs from '$lib/components/ContentTabs.svelte';
	import Comments from '$lib/components/Comments.svelte';
	import ForumCategories from '$lib/components/ForumCategories.svelte';
	import PostCategories from '$lib/components/PostCategories.svelte';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import {
		canEditContent,
		fetchContentRevisions,
		loadContentByItemId,
		type ContentRevisionMeta,
		type LoadedContent
	} from '$lib/services/content';
	import { connections } from '$lib/services/connections.svelte';
	import { getSubscriptionDecodedEvent, itemIdIndexerKey, subscribeIndexerEvents } from '$lib/services/indexer.svelte';

	let loading = $state(false);
	let error = $state('');
	let content: LoadedContent | null = $state(null);
	let revisions: ContentRevisionMeta[] = $state([]);
	let selectedRevisionId = $state<string>('');
	let requestId = 0;
	let refreshNonce = $state(0);
	let commentsRefreshNonce = $state(0);

	const itemId = $derived(page.params.item_id);
	const canEdit = $derived(canEditContent(content, injectedAccounts.activeAccount));

	$effect(() => {
		void itemId;
		void refreshNonce;
		const heliaNode = connections.heliaNode;
		if (!heliaNode || !itemId) return;

		const currentRequestId = ++requestId;
		loading = true;
		error = '';
		content = null;
		const revisionId = selectedRevisionId === '' ? null : Number(selectedRevisionId);
		void loadContentByItemId(heliaNode, itemId, connections.api, revisionId)
			.then(async (value) => {
				if (currentRequestId !== requestId) return;
				content = value;
				const normalizedItemId = itemId.startsWith('0x') ? itemId : `0x${itemId}`;
				const chainLatestRevisionId = value.latestRevisionId;
				if (chainLatestRevisionId != null && chainLatestRevisionId > 0) {
					revisions = await fetchContentRevisions(normalizedItemId);
					if (currentRequestId !== requestId) return;
					if (selectedRevisionId === '' && value.revisionId != null) {
						selectedRevisionId = String(value.revisionId);
					}
				} else {
					revisions = [];
				}
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

	$effect(() => {
		void itemId;
		selectedRevisionId = '';
		revisions = [];
	});

	$effect(() => {
		if (!itemId) return;
		const normalizedItemId = itemId.startsWith('0x') ? itemId : `0x${itemId}`;
		const unsubscribe = subscribeIndexerEvents(itemIdIndexerKey(normalizedItemId), (message) => {
			const decoded = getSubscriptionDecodedEvent(message);
			if (decoded?.event.palletName !== 'Content') return;
			if (decoded.event.eventName === 'PublishRevision') {
				const viewingLatest = selectedRevisionId === '' || selectedRevisionId === String(content?.latestRevisionId ?? '');
				if (viewingLatest) selectedRevisionId = '';
				refreshNonce += 1;
			} else if (decoded.event.eventName === 'PublishItem') {
				commentsRefreshNonce += 1;
			}
		});
		return unsubscribe;
	});

	function contentTypeLabel(value: LoadedContent | null): string {
		switch (value?.contentType) {
			case 'profile':
				return 'Profile';
			case 'forum':
				return 'Forum';
			case 'category':
				return 'Category';
			case 'forumPost':
				return 'Forum post';
			case 'comment':
				return 'Comment';
			default:
				return 'Unknown content';
		}
	}
</script>

<div class="max-w-4xl space-y-6">
	<header
		class="card flex flex-wrap items-start justify-between gap-4 border-dashed p-6"
	>
		<div>
			<p class="text-sm font-medium text-surface-700-300">Content viewer</p>
			<h1 class="mt-1 text-2xl font-semibold">{contentTypeLabel(content)}</h1>
			<p class="mt-2 text-sm break-all text-surface-700-300">{itemId}</p>
		</div>
		<div class="flex gap-3">
			<a class="variant-outline btn" href={resolve('/my-profile')}>My profile</a>
		</div>
	</header>

	{#if content}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<ContentTabs {itemId} {canEdit} active="view" />
			{#if revisions.length > 1}
				<label class="flex items-center gap-2 text-xs text-surface-700-300">
					Revision
					<select class="select w-44" bind:value={selectedRevisionId} aria-label="Select revision">
						{#each revisions as revision (revision.revisionId)}
							<option value={String(revision.revisionId)}>
								Revision {revision.revisionId}{revision.revisionId === content.latestRevisionId
									? ' (latest)'
									: ''}
							</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>
	{/if}

	{#if loading}
		<div class="card px-4 py-3 text-sm">
			Loading content…
		</div>
	{:else if error}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">
			{error}
		</div>
	{:else if content}
		<section class="card p-6">
			<div class="mb-4">
				<p class="text-xs text-surface-700-300 uppercase">Type</p>
				<p class="mt-1 text-sm font-medium">{contentTypeLabel(content)}</p>
				<p class="mt-1 text-xs text-surface-700-300">
					content_type_id: {content.contentTypeId ?? '—'}
				</p>
			</div>

			<h2 class="text-2xl font-semibold">{content.title || 'Untitled content'}</h2>

			{#if content.profileLocation}
				<p class="mt-2 text-sm text-surface-700-300">Location: {content.profileLocation}</p>
			{/if}

			{#if content.imagePreviewDataUrl}
				<img
					src={content.imagePreviewDataUrl}
					alt={content.title || 'Content image'}
					class="mt-6 max-h-80 rounded-xl object-cover"
				/>
			{/if}

			{#if content.bodyText}
				<div class="prose mt-6 max-w-none whitespace-pre-wrap prose-invert">
					{content.bodyText}
				</div>
			{/if}

			{#if content.contentType === 'forum'}
				<ForumCategories forum={content} />
			{:else if content.contentType === 'category'}
				<CategoryForumPosts category={content} />
			{:else if content.contentType === 'forumPost' && content.latestLinks.length}
				<PostCategories post={content} />
			{/if}

			{#if content.contentType === 'forumPost' || content.contentType === 'comment'}
				<Comments item={content} refreshNonce={commentsRefreshNonce} />
			{/if}
		</section>
	{/if}
</div>
