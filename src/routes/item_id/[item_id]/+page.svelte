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
		loadContentByItemId,
		fetchContentRevisions,
		type ContentRevisionMeta,
		type LoadedContent
	} from '$lib/services/content';
	import { connections } from '$lib/services/connections.svelte';
	import {
		getSubscriptionDecodedEvent,
		itemIdIndexerKey,
		subscribeIndexerEvents
	} from '$lib/services/indexer.svelte';
	import {
		fetchTrustedAccounts,
		getAccountTrustStatus,
		loadTrustedAccountSummaries,
		loadTrustedAccountSummary,
		trustAccount,
		untrustAccount,
		type TrustedAccountSummary
	} from '$lib/services/trusted-accounts';

	let loading = $state(false);
	let error = $state('');
	let content: LoadedContent | null = $state(null);
	let revisions: ContentRevisionMeta[] = $state([]);
	let selectedRevisionId = $state<string>('');
	let authorName = $state('');
	let authorAddress = $state('');
	let authorProfileItemIdHex = $state<string | null>(null);
	let authorLoading = $state(false);
	let trustLoading = $state(false);
	let trustError = $state('');
	let trustStatus = $state({
		isOwnAccount: false,
		isDirectlyTrusted: false,
		isTrustedViaExtendedGraph: false,
		trustedVia: [] as string[]
	});
	let requestId = 0;
	let refreshNonce = $state(0);
	let commentsRefreshNonce = $state(0);
	let trustRefreshNonce = $state(0);
	let trustedAccounts = $state<TrustedAccountSummary[]>([]);
	let trustedThatTrusts = $state<TrustedAccountSummary[]>([]);
	let trustListsLoading = $state(false);

	const itemId = $derived(page.params.item_id);
	const canEdit = $derived(canEditContent(content, injectedAccounts.activeAccount));
	const canRenderProtectedContent = $derived(
		isProfileContent(content) ||
			!authorAddress ||
			trustStatus.isOwnAccount ||
			trustStatus.isTrustedViaExtendedGraph
	);
	const trustIcon = $derived(trustStatus.isOwnAccount ? '' : '🛡');
	const trustButtonClass = $derived(
		trustStatus.isDirectlyTrusted
			? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
			: trustStatus.isTrustedViaExtendedGraph
				? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
				: 'border-surface-300-700 text-surface-700-300'
	);
	const trustButtonLabel = $derived(
		trustStatus.isOwnAccount
			? ''
			: trustStatus.isDirectlyTrusted
				? 'Remove direct trust'
				: trustStatus.isTrustedViaExtendedGraph
					? 'Add direct trust for this author'
					: 'Trust this author'
	);

	$effect(() => {
		void itemId;
		void refreshNonce;
		const heliaNode = connections.ipfsConnected;
		if (!heliaNode || !itemId) return;

		const currentRequestId = ++requestId;
		loading = true;
		error = '';
		content = null;
		const revisionId = selectedRevisionId === '' ? null : Number(selectedRevisionId);
		void loadContentByItemId(itemId, connections.api, revisionId)
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
		authorName = '';
		authorAddress = '';
		authorProfileItemIdHex = null;
		trustError = '';
		trustStatus = {
			isOwnAccount: false,
			isDirectlyTrusted: false,
			isTrustedViaExtendedGraph: false,
			trustedVia: []
		};
		trustedAccounts = [];
		trustedThatTrusts = [];
		trustListsLoading = false;
	});

	$effect(() => {
		if (!itemId) return;
		const normalizedItemId = itemId.startsWith('0x') ? itemId : `0x${itemId}`;
		const unsubscribe = subscribeIndexerEvents(itemIdIndexerKey(normalizedItemId), (message) => {
			const decoded = getSubscriptionDecodedEvent(message);
			if (decoded?.event.palletName !== 'Content') return;
			if (decoded.event.eventName === 'PublishRevision') {
				const viewingLatest =
					selectedRevisionId === '' ||
					selectedRevisionId === String(content?.latestRevisionId ?? '');
				if (viewingLatest) selectedRevisionId = '';
				refreshNonce += 1;
			} else if (decoded.event.eventName === 'PublishItem') {
				commentsRefreshNonce += 1;
			}
		});
		return unsubscribe;
	});

	$effect(() => {
		void content?.ownerHex;
		void trustRefreshNonce;
		const api = connections.api;
		const activeAddress = injectedAccounts.activeAccount?.address ?? '';
		if (!api || !content?.ownerHex) {
			authorName = '';
			authorAddress = '';
			authorProfileItemIdHex = null;
			trustStatus = {
				isOwnAccount: false,
				isDirectlyTrusted: false,
				isTrustedViaExtendedGraph: false,
				trustedVia: []
			};
			trustedAccounts = [];
			trustedThatTrusts = [];
			trustListsLoading = false;
			return;
		}

		const author = content.ownerHex;
		const isProfileContent = content.contentType === 'profile';
		authorLoading = true;
		void loadTrustedAccountSummary(api, author)
			.then(async (summary) => {
				authorAddress = summary.address;
				authorName = summary.displayName;
				authorProfileItemIdHex = summary.profileItemIdHex;

				if (!activeAddress) {
					trustStatus = {
						isOwnAccount: false,
						isDirectlyTrusted: false,
						isTrustedViaExtendedGraph: true,
						trustedVia: []
					};
				} else {
					trustStatus = await getAccountTrustStatus(api, activeAddress, summary.address);
				}

				if (!isProfileContent) {
					trustedAccounts = [];
					trustedThatTrusts = [];
					trustListsLoading = false;
					return;
				}

				trustListsLoading = true;
				const trustedAddresses = await fetchTrustedAccounts(api, summary.address);
				const [trustedSummaries, trustedViaSummaries] = await Promise.all([
					loadTrustedAccountSummaries(api, trustedAddresses),
					loadTrustedAccountSummaries(api, trustStatus.trustedVia)
				]);
				trustedAccounts = trustedSummaries;
				trustedThatTrusts = trustedViaSummaries;
			})
			.catch((value) => {
				trustError = value instanceof Error ? value.message : String(value);
				trustedAccounts = [];
				trustedThatTrusts = [];
			})
			.finally(() => {
				authorLoading = false;
				trustListsLoading = false;
			});
	});

	async function toggleTrust() {
		if (
			!connections.api ||
			!injectedAccounts.activeAccount ||
			!authorAddress ||
			trustStatus.isOwnAccount
		) {
			return;
		}
		trustError = '';
		trustLoading = true;
		try {
			if (trustStatus.isDirectlyTrusted) {
				await untrustAccount(connections.api, injectedAccounts.activeAccount, authorAddress);
			} else {
				await trustAccount(connections.api, injectedAccounts.activeAccount, authorAddress);
			}
			trustRefreshNonce += 1;
		} catch (value) {
			trustError = value instanceof Error ? value.message : String(value);
		} finally {
			trustLoading = false;
		}
	}

	function isProfileContent(value: LoadedContent | null): boolean {
		return value?.contentType === 'profile';
	}

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

	function formatTimestamp(value: number | null): string {
		return value == null ? '—' : new Date(value).toLocaleString();
	}

	function trustStatusText(): string {
		if (!authorAddress) return 'Loading author…';
		if (content?.contentType === 'profile') {
			if (!injectedAccounts.activeAccount) return 'Profiles are always visible.';
			if (trustStatus.isOwnAccount) return 'You are viewing your own profile.';
			if (trustStatus.isDirectlyTrusted) return 'Profile visible. This account is directly trusted by your current account.';
			if (trustStatus.isTrustedViaExtendedGraph)
				return 'Profile visible through your extended one-hop trust graph.';
			return 'Profiles are always visible, even outside your extended trust graph.';
		}
		if (!injectedAccounts.activeAccount) return 'Connect an account to use trust filters.';
		if (trustStatus.isOwnAccount) return 'You are the author.';
		if (trustStatus.isDirectlyTrusted) return 'Directly trusted by your current account.';
		if (trustStatus.isTrustedViaExtendedGraph)
			return 'Visible through your extended one-hop trust graph.';
		return 'Body and image hidden because this author is outside your extended trust graph.';
	}
</script>

<div class="max-w-4xl space-y-6">
	<header class="flex flex-wrap items-start justify-between gap-4 card border-dashed p-6">
		<div>
			<h1 class="text-2xl font-semibold">{content?.title || 'Loading item…'}</h1>
		</div>
	</header>

	{#if content}
		<div class="px-6">
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
		</div>
	{/if}

	{#if loading}
		<div class="card px-4 py-3 text-sm">Loading content…</div>
	{:else if error}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">
			{error}
		</div>
	{:else if content}
		<section class="card p-6">
			<div class="mb-4 space-y-1">
				<p class="text-xs text-surface-700-300">
					Created: {formatTimestamp(content.createdAtMs)}
				</p>
				<p class="text-xs text-surface-700-300">
					Modified: {formatTimestamp(content.modifiedAtMs)}
				</p>
			</div>


			<div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-surface-700-300">
				<span>By</span>
				{#if authorProfileItemIdHex}
					<a class="anchor font-medium" href={resolve(`/item_id/${authorProfileItemIdHex}`)}>
						{authorName || 'Loading author…'}
					</a>
				{:else}
					<span class="font-medium"
						>{authorName || (authorLoading ? 'Loading author…' : 'Unknown author')}</span
					>
				{/if}
				{#if authorAddress && !trustStatus.isOwnAccount}
					<button
						type="button"
						class={[
							'rounded-full border px-2 py-1 text-base leading-none transition-colors hover:bg-surface-100-900',
							trustButtonClass
						]}
						title={trustButtonLabel}
						aria-label={trustButtonLabel}
						disabled={trustLoading}
						onclick={() => void toggleTrust()}
					>
						{trustLoading ? '…' : trustIcon}
					</button>
				{/if}
			</div>
			<p class="mt-2 text-sm text-surface-700-300">{trustStatusText()}</p>
			{#if trustStatus.trustedVia.length > 0}
				<p class="mt-1 text-xs text-surface-700-300">
					Trusted via {trustStatus.trustedVia.length} directly trusted account{trustStatus
						.trustedVia.length === 1
						? ''
						: 's'}.
				</p>
			{/if}
			{#if trustError}
				<p class="mt-2 text-sm text-red-300">{trustError}</p>
			{/if}

			{#if content.profileLocation}
				<p class="mt-2 text-sm text-surface-700-300">Location: {content.profileLocation}</p>
			{/if}


			{#if canRenderProtectedContent && content.imagePreviewDataUrl}
				<img
					src={content.imagePreviewDataUrl}
					alt={content.title || 'Content image'}
					class="mt-6 max-h-80 rounded-xl object-cover"
				/>
			{:else if !canRenderProtectedContent && content.imagePreviewDataUrl}
				<div
					class="mt-6 rounded-xl border border-dashed border-surface-300-700 p-6 text-sm text-surface-700-300"
				>
					Image hidden because the author is outside your extended trust graph.
				</div>
			{/if}

			{#if content.contentType === 'profile'}
				<div class="mt-6 grid gap-4 md:grid-cols-2">
					<div class="rounded-xl border border-surface-300-700 p-4">
						<h3 class="text-sm font-semibold">Trusted That Trusts</h3>
						<p class="mt-1 text-xs text-surface-700-300">
							Accounts you directly trust that also trust this profile.
						</p>
						{#if !injectedAccounts.activeAccount}
							<p class="mt-3 text-sm text-surface-700-300">
								Connect an account to compute this list.
							</p>
						{:else if trustListsLoading}
							<p class="mt-3 text-sm text-surface-700-300">Loading accounts…</p>
						{:else if trustedThatTrusts.length === 0}
							<p class="mt-3 text-sm text-surface-700-300">No matching accounts.</p>
						{:else}
							<ul class="mt-3 space-y-2 text-sm">
								{#each trustedThatTrusts as account (account.address)}
									<li>
										{#if account.profileItemIdHex}
											<a class="anchor" href={resolve(`/item_id/${account.profileItemIdHex}`)}>
												{account.displayName}
											</a>
										{:else}
											<span>{account.displayName}</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					<div class="rounded-xl border border-surface-300-700 p-4">
						<h3 class="text-sm font-semibold">Trusts</h3>
						<p class="mt-1 text-xs text-surface-700-300">
							Accounts this profile directly trusts.
						</p>
						{#if trustListsLoading}
							<p class="mt-3 text-sm text-surface-700-300">Loading accounts…</p>
						{:else if trustedAccounts.length === 0}
							<p class="mt-3 text-sm text-surface-700-300">This profile does not currently trust any accounts.</p>
						{:else}
							<ul class="mt-3 space-y-2 text-sm">
								{#each trustedAccounts as account (account.address)}
									<li>
										{#if account.profileItemIdHex}
											<a class="anchor" href={resolve(`/item_id/${account.profileItemIdHex}`)}>
												{account.displayName}
											</a>
										{:else}
											<span>{account.displayName}</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>
			{/if}

			{#if canRenderProtectedContent && content.bodyText}
				<div class="prose mt-6 max-w-none whitespace-pre-wrap prose-invert">
					{content.bodyText}
				</div>
			{:else if !canRenderProtectedContent}
				<div
					class="mt-6 rounded-xl border border-dashed border-surface-300-700 p-6 text-sm text-surface-700-300"
				>
					This post body is hidden because the author is outside your extended trust graph.
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
