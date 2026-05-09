<script lang="ts">
	import { resolve } from '$app/paths';
	import { loadContentByItemId, type LoadedContent } from '$lib/services/content';
	import { connections } from '$lib/services/connections.svelte';

	let { post }: { post: LoadedContent } = $props();

	type CategoryLink = { itemIdHex: string; title: string };
	let categories: CategoryLink[] = $state([]);
	let loading = $state(false);
	let error = $state('');
	let requestId = 0;

	$effect(() => {
		void post.itemIdHex;
		void post.latestLinks.join(',');
		const heliaNode = connections.ipfsConnected;
		if (!heliaNode || post.contentType !== 'forumPost') return;

		const currentRequestId = ++requestId;
		categories = [];
		error = '';
		loading = post.latestLinks.length > 0;

		void Promise.all(
			post.latestLinks.map(async (itemIdHex) => {
				const category = await loadContentByItemId(itemIdHex, connections.api).catch(() => null);
				return {
					itemIdHex,
					title:
						category?.contentType === 'category' && category.title.trim()
							? category.title
							: itemIdHex
				};
			})
		)
			.then((value) => {
				if (currentRequestId !== requestId) return;
				categories = value;
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
</script>

<div class="mt-8 border-t border-surface-200-800 pt-6">
	<h3 class="text-xl font-semibold">Categories</h3>
	{#if error}
		<div
			class="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
		>
			{error}
		</div>
	{/if}
	{#if loading}
		<p class="mt-3 text-sm text-surface-700-300">Loading categories…</p>
	{:else}
		<ul class="mt-3 space-y-2 text-sm">
			{#each categories as category (category.itemIdHex)}
				<li>
					<a
						class="break-all hover:underline"
						href={resolve(`/item_id/${encodeURIComponent(category.itemIdHex)}`)}>{category.title}</a
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>
