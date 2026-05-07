<script lang="ts">
	import { page } from '$app/state';
	import {
		accountAddressToHex,
		ipfsDigestHexToCid,
		loadContentById,
		loadForumCategoriesIncremental,
		retractItem,
		saveCategory,
		shortHex,
		type ForumCategory,
		type LoadedContent
	} from '$lib/services/content';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';

	let loading = $state(false);
	let error = $state('');
	let content: LoadedContent | null = $state(null);
	let categories: ForumCategory[] = $state([]);
	let categoryError = $state('');
	let categoryNotice = $state('');
	let categorySaving = $state(false);
	let categoryLoading = $state(false);
	let categoryDraft = $state({ title: '', body: '' });
	let requestId = 0;
	let categoryRequestId = 0;

	const contentId = $derived(page.params.content_id);
	const isForumOwner = $derived.by(() => {
		const value = content as LoadedContent | null;
		const account = injectedAccounts.activeAccount;
		return value?.contentType === 'forum' && !!value.ownerHex && !!account && value.ownerHex.toLowerCase() === accountAddressToHex(account.address).toLowerCase();
	});

	$effect(() => {
		void contentId;
		const heliaNode = connections.heliaNode;
		if (!heliaNode || !contentId) return;

		const currentRequestId = ++requestId;
		++categoryRequestId;
		loading = true;
		error = '';
		content = null;
		categories = [];
		categoryLoading = false;
		categoryError = '';
		categoryNotice = '';
		void loadContentById(heliaNode, contentId, connections.api)
			.then((value) => {
				if (currentRequestId !== requestId) return;
				content = value;
				if (value.contentType === 'forum') void refreshCategories(value);
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

	function contentTypeLabel(value: LoadedContent | null): string {
		switch (value?.contentType) {
			case 'profile':
				return 'Profile';
			case 'forum':
				return 'Forum';
			case 'category':
				return 'Category';
			default:
				return 'Unknown content';
		}
	}

	async function refreshCategories(forum = content) {
		if (!connections.heliaNode || !forum || forum.contentType !== 'forum') return;
		const currentCategoryRequestId = ++categoryRequestId;
		categories = [];
		categoryLoading = true;
		try {
			await loadForumCategoriesIncremental({
				heliaNode: connections.heliaNode,
				api: connections.api,
				forum,
				onCategory: (category) => {
					if (currentCategoryRequestId !== categoryRequestId) return;
					categories = [...categories, category];
				}
			});
		} catch (value) {
			if (currentCategoryRequestId === categoryRequestId) categoryError = value instanceof Error ? value.message : String(value);
		} finally {
			if (currentCategoryRequestId === categoryRequestId) categoryLoading = false;
		}
	}

	async function addCategory() {
		if (!connections.api || !connections.heliaNode || !injectedAccounts.activeAccount || !content) return;
		categoryError = '';
		categoryNotice = '';
		categorySaving = true;
		try {
			await saveCategory({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: injectedAccounts.activeAccount,
				forumItemIdHex: content.itemIdHex,
				draft: categoryDraft
			});
			categoryDraft = { title: '', body: '' };
			categoryNotice = 'Category published.';
			await refreshCategories();
		} catch (value) {
			categoryError = value instanceof Error ? value.message : String(value);
		} finally {
			categorySaving = false;
		}
	}

	async function removeCategory(category: ForumCategory) {
		if (!connections.api || !injectedAccounts.activeAccount) return;
		categoryError = '';
		categoryNotice = '';
		categorySaving = true;
		try {
			await retractItem(connections.api, injectedAccounts.activeAccount, category.itemIdHex);
			categoryNotice = 'Category retracted.';
			await refreshCategories();
		} catch (value) {
			categoryError = value instanceof Error ? value.message : String(value);
		} finally {
			categorySaving = false;
		}
	}
</script>

<div class="max-w-4xl space-y-6">
	<header class="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-surface-200-800 p-6">
		<div>
			<p class="text-surface-700-300 text-sm font-medium">Content viewer</p>
			<h1 class="mt-1 text-2xl font-semibold">{contentTypeLabel(content)}</h1>
			<p class="text-surface-700-300 mt-2 text-sm break-all">{contentId}</p>
		</div>
		<div class="flex gap-3">
			<a class="btn variant-outline" href="/my-profile">My profile</a>
			<a class="btn variant-outline" href="/create-forum">Create forum</a>
		</div>
	</header>

	{#if loading}
		<div class="rounded-xl border border-surface-200-800 bg-surface-50-950 px-4 py-3 text-sm">Loading content…</div>
	{:else if error}
		<div class="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
	{:else if content}
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-6">
				<div class="mb-4">
					<p class="text-surface-700-300 text-xs uppercase">Type</p>
					<p class="mt-1 text-sm font-medium">{contentTypeLabel(content)}</p>
					<p class="text-surface-700-300 mt-1 text-xs">content_type_id: {content.contentTypeId ?? '—'}</p>
				</div>

				<h2 class="text-2xl font-semibold">{content.title || 'Untitled content'}</h2>

				{#if content.profileLocation}
					<p class="text-surface-700-300 mt-2 text-sm">Location: {content.profileLocation}</p>
				{/if}

				{#if content.imagePreviewDataUrl}
					<img src={content.imagePreviewDataUrl} alt={content.title || 'Content image'} class="mt-6 max-h-80 rounded-xl object-cover" />
				{/if}

				{#if content.bodyText}
					<div class="prose prose-invert mt-6 max-w-none whitespace-pre-wrap">{content.bodyText}</div>
				{/if}

				{#if content.contentType === 'forum'}
					<div class="mt-8 border-t border-surface-200-800 pt-6">
						<div class="flex items-center justify-between gap-3">
							<h3 class="text-xl font-semibold">Categories</h3>
							<p class="text-surface-700-300 text-sm">{categories.length} valid categor{categories.length === 1 ? 'y' : 'ies'}{categoryLoading ? ' loading…' : ''}</p>
						</div>

						{#if categoryError}
							<div class="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{categoryError}</div>
						{/if}
						{#if categoryNotice}
							<div class="mt-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">{categoryNotice}</div>
						{/if}

						{#if isForumOwner}
							<form class="mt-4 space-y-3 rounded-lg border border-surface-200-800 bg-surface-100-900 p-4" onsubmit={(event) => { event.preventDefault(); void addCategory(); }}>
								<h4 class="font-semibold">Add category</h4>
								<input class="w-full rounded-lg border-surface-200-800 bg-surface-50-950" bind:value={categoryDraft.title} placeholder="Category title" disabled={categorySaving} required />
								<textarea class="min-h-24 w-full rounded-lg border-surface-200-800 bg-surface-50-950" bind:value={categoryDraft.body} placeholder="Category body" disabled={categorySaving}></textarea>
								<button class="btn variant-filled" type="submit" disabled={categorySaving || !categoryDraft.title.trim()}>{categorySaving ? 'Publishing…' : 'Publish category'}</button>
							</form>
						{/if}

						<div class="mt-4 space-y-3">
							{#each categories as category}
								<article class="rounded-lg border border-surface-200-800 bg-surface-100-900 p-4">
									<div class="flex items-start justify-between gap-3">
										<div>
											<h4 class="font-semibold">{category.title || 'Untitled category'}</h4>
											{#if category.bodyText}<p class="text-surface-700-300 mt-2 whitespace-pre-wrap text-sm">{category.bodyText}</p>{/if}
											<code class="text-surface-700-300 mt-2 block break-all text-xs">{category.itemIdHex}</code>
										</div>
										{#if isForumOwner}
											<button class="btn variant-outline" type="button" disabled={categorySaving} onclick={() => void removeCategory(category)}>Remove</button>
										{/if}
									</div>
								</article>
							{:else}
								<p class="text-surface-700-300 text-sm">{categoryLoading ? 'Loading categories…' : 'No valid categories found.'}</p>
							{/each}
						</div>
					</div>
				{/if}
			</section>

			<aside class="space-y-4 rounded-xl border border-surface-200-800 bg-surface-50-950 p-4 text-sm">
				<div>
					<p class="text-surface-700-300 text-xs uppercase">Item ID</p>
					<code class="mt-1 block break-all text-xs">{content.itemIdHex}</code>
				</div>
				<div>
					<p class="text-surface-700-300 text-xs uppercase">Latest revision</p>
					<code class="mt-1 block break-all text-xs">{ipfsDigestHexToCid(content.revisionIpfsHashHex)}</code>
				</div>
				<div>
					<p class="text-surface-700-300 text-xs uppercase">Content type</p>
					<p class="mt-1">{contentTypeLabel(content)}</p>
					<p class="text-surface-700-300 mt-1 text-xs">ID: {content.contentTypeId ?? '—'}</p>
				</div>
				<div>
					<p class="text-surface-700-300 text-xs uppercase">Language</p>
					<p class="mt-1">{content.languageTag ?? '—'}</p>
				</div>
				<div>
					<p class="text-surface-700-300 text-xs uppercase">Profile account type</p>
					<p class="mt-1">{content.profileAccountType ?? '—'}</p>
				</div>
				<div>
					<p class="text-surface-700-300 text-xs uppercase">Mixins</p>
					<ul class="mt-1 space-y-1 text-xs">
						{#each content.rawMixinIds as mixinId}
							<li><code>{shortHex(`0x${mixinId.toString(16).padStart(8, '0')}`)}</code></li>
						{/each}
					</ul>
				</div>
			</aside>
		</div>
	{/if}
</div>
