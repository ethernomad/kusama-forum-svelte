<script lang="ts">
	import {
		accountAddressToHex,
		loadForumCategoriesIncremental,
		retractItem,
		saveCategory,
		type ForumCategory,
		type LoadedContent
	} from '$lib/services/content';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';

	let { forum }: { forum: LoadedContent } = $props();

	let categories: ForumCategory[] = $state([]);
	let categoryError = $state('');
	let categoryNotice = $state('');
	let categorySaving = $state(false);
	let categoryLoading = $state(false);
	let categoryDraft = $state({ title: '', body: '' });
	let categoryRequestId = 0;

	const isForumOwner = $derived.by(() => {
		const account = injectedAccounts.activeAccount;
		return !!forum.ownerHex && !!account && forum.ownerHex.toLowerCase() === accountAddressToHex(account.address).toLowerCase();
	});

	$effect(() => {
		void forum.itemIdHex;
		if (!connections.heliaNode || forum.contentType !== 'forum') return;
		categoryError = '';
		categoryNotice = '';
		void refreshCategories();
	});

	async function refreshCategories() {
		if (!connections.heliaNode || forum.contentType !== 'forum') return;
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
		if (!connections.api || !connections.heliaNode || !injectedAccounts.activeAccount) return;
		categoryError = '';
		categoryNotice = '';
		categorySaving = true;
		try {
			await saveCategory({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: injectedAccounts.activeAccount,
				forumItemIdHex: forum.itemIdHex,
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
						<a class="text-lg font-semibold hover:underline" href={`/${encodeURIComponent(category.itemIdHex)}`}>{category.title || 'Untitled category'}</a>
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
