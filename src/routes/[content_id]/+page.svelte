<script lang="ts">
	import { page } from '$app/state';
	import CategoryForumPosts from '$lib/components/CategoryForumPosts.svelte';
	import ForumCategories from '$lib/components/ForumCategories.svelte';
	import PostCategories from '$lib/components/PostCategories.svelte';
	import { ipfsDigestHexToCid, loadContentById, shortHex, type LoadedContent } from '$lib/services/content';
	import { connections } from '$lib/services/connections.svelte';

	let loading = $state(false);
	let error = $state('');
	let content: LoadedContent | null = $state(null);
	let requestId = 0;

	const contentId = $derived(page.params.content_id);

	$effect(() => {
		void contentId;
		const heliaNode = connections.heliaNode;
		if (!heliaNode || !contentId) return;

		const currentRequestId = ++requestId;
		loading = true;
		error = '';
		content = null;
		void loadContentById(heliaNode, contentId, connections.api)
			.then((value) => {
				if (currentRequestId !== requestId) return;
				content = value;
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
			case 'forumPost':
				return 'Forum post';
			default:
				return 'Unknown content';
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
					<ForumCategories forum={content} />
				{:else if content.contentType === 'category'}
					<CategoryForumPosts category={content} />
				{:else if content.contentType === 'forumPost' && content.latestLinks.length}
					<PostCategories post={content} />
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
