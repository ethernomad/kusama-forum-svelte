<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
	import { PUBLISH_NOTICE_PREPARING } from '$lib/services/publish-notices';

	let { forum }: { forum: LoadedContent } = $props();

	let categories: ForumCategory[] = $state([]);
	let categoryError = $state('');
	let categoryNotice = $state('');
	let categorySaving = $state(false);
	let categoryLoading = $state(false);
	let categoryDraft = $state({ title: '', body: '' });
	let selectedImageFile: File | null = $state(null);
	let selectedImagePreview: string | null = $state(null);
	let categoryRequestId = 0;

	const isForumOwner = $derived.by(() => {
		const account = injectedAccounts.activeAccount;
		return (
			!!forum.ownerHex &&
			!!account &&
			forum.ownerHex.toLowerCase() === accountAddressToHex(account.address).toLowerCase()
		);
	});

	$effect(() => {
		void forum.itemIdHex;
		if (!connections.ipfsConnected || forum.contentType !== 'forum') return;
		categoryError = '';
		categoryNotice = '';
		void refreshCategories();
	});

	async function refreshCategories() {
		if (!connections.ipfsConnected || forum.contentType !== 'forum') return;
		const currentCategoryRequestId = ++categoryRequestId;
		categories = [];
		categoryLoading = true;
		try {
			await loadForumCategoriesIncremental({
				api: connections.api,
				forum,
				onCategory: (category) => {
					if (currentCategoryRequestId !== categoryRequestId) return;
					categories = [...categories, category];
				}
			});
		} catch (value) {
			if (currentCategoryRequestId === categoryRequestId)
				categoryError = value instanceof Error ? value.message : String(value);
		} finally {
			if (currentCategoryRequestId === categoryRequestId) categoryLoading = false;
		}
	}

	async function fileToDataUrl(file: File) {
		return await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result ?? ''));
			reader.onerror = () => reject(reader.error ?? new Error('Failed to read image.'));
			reader.readAsDataURL(file);
		});
	}

	async function handleImageChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		selectedImageFile = file;
		selectedImagePreview = file ? await fileToDataUrl(file) : null;
	}

	async function addCategory() {
		if (!connections.api || !connections.ipfsConnected || !injectedAccounts.activeAccount) return;
		categoryError = '';
		categoryNotice = '';
		categorySaving = true;
		try {
			categoryNotice = PUBLISH_NOTICE_PREPARING;
			const category = await saveCategory({
				api: connections.api,
				account: injectedAccounts.activeAccount,
				forumItemIdHex: forum.itemIdHex,
				draft: categoryDraft,
				selectedImageFile
			});
			categoryDraft = { title: '', body: '' };
			selectedImageFile = null;
			selectedImagePreview = null;
			await goto(resolve(`/item_id/${encodeURIComponent(category.itemIdHex)}`));
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
		{#if categoryLoading}
			<p class="text-sm text-surface-700-300">Loading categories…</p>
		{/if}
	</div>

	{#if categoryError}
		<div class="mt-4 card border-red-500/40 px-3 py-2 text-sm text-red-200">{categoryError}</div>
	{/if}
	{#if categoryNotice}
		<div class="mt-4 card border-green-500/40 px-3 py-2 text-sm text-green-200">
			{categoryNotice}
		</div>
	{/if}

	<div class="mt-4 space-y-3">
		{#each categories as category (category.itemIdHex)}
			<article class="card p-4">
				<div class="flex items-start justify-between gap-3">
					<div class="flex min-w-0 items-start gap-4">
						<div
							class="flex aspect-square size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-200-800"
						>
							{#if category.imagePreviewDataUrl}
								<img
									src={category.imagePreviewDataUrl}
									alt={category.title || 'Category image'}
									class="size-full object-cover"
								/>
							{:else}
								<span class="text-xs font-medium tracking-wide text-surface-700-300 uppercase"
									>No image</span
								>
							{/if}
						</div>
						<div class="min-w-0">
							<a
								class="text-lg font-semibold hover:underline"
								href={resolve(`/item_id/${encodeURIComponent(category.itemIdHex)}`)}
								>{category.title || 'Untitled category'}</a
							>
							{#if category.bodyText}
								<p class="mt-2 text-sm whitespace-pre-wrap text-surface-700-300">{category.bodyText}</p>
							{/if}
						</div>
					</div>
					{#if isForumOwner}
						<button
							class="variant-outline btn"
							type="button"
							disabled={categorySaving}
							onclick={() => void removeCategory(category)}
						>
							Remove
						</button>
					{/if}
				</div>
			</article>
		{:else}
			<p class="text-surface-700-300 text-sm">
				{categoryLoading ? 'Loading categories…' : 'No valid categories found.'}
			</p>
		{/each}
	</div>

	{#if isForumOwner}
		<form
			class="mt-4 space-y-3 card p-4"
			onsubmit={(event) => {
				event.preventDefault();
				void addCategory();
			}}
		>
			<h4 class="font-semibold">Add category</h4>
			<input
				class="input w-full"
				bind:value={categoryDraft.title}
				placeholder="Category title"
				disabled={categorySaving}
				required
			/>
			<textarea
				class="textarea min-h-24 w-full"
				bind:value={categoryDraft.body}
				placeholder="Category body"
				disabled={categorySaving}
			></textarea>
			<label class="block space-y-2 text-sm">
				<span class="font-medium">Category image</span>
				<input
					class="input w-full text-sm"
					type="file"
					accept="image/*"
					onchange={handleImageChange}
					disabled={categorySaving}
				/>
				<p class="text-xs text-surface-700-300">
					Images are re-encoded to JPEG and uploaded to IPFS as mipmap levels before publishing
					the category item.
				</p>
			</label>
			<div class="space-y-3 card p-4">
				<p class="text-sm font-medium">Preview</p>
				{#if selectedImagePreview}
					<img
						src={selectedImagePreview}
						alt={categoryDraft.title.trim() || 'Category image preview'}
						class="aspect-video w-full rounded-xl object-cover"
					/>
				{:else}
					<div
						class="flex aspect-video w-full items-center justify-center rounded-xl bg-surface-100-900 text-sm text-surface-700-300"
					>
						No image
					</div>
				{/if}
			</div>
			<button
				class="variant-filled btn"
				type="submit"
				disabled={categorySaving || !connections.ipfsConnected || !categoryDraft.title.trim()}
			>
				{categorySaving ? 'Publishing…' : 'Publish category'}
			</button>
		</form>
	{/if}
</div>
