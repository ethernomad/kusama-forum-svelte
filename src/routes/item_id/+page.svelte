<script lang="ts">
	let contentLookupId = $state('');
</script>

<div class="max-w-4xl space-y-6">
	<header class="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-surface-200-800 p-6">
		<div>
			<p class="text-sm font-medium text-surface-700-300">Content viewer</p>
			<h1 class="mt-1 text-2xl font-semibold">Open content by item ID</h1>
			<p class="mt-2 text-sm text-surface-700-300">
				Paste an item ID to jump directly to any forum, category, post, comment, or profile content page.
			</p>
		</div>
		<div class="flex gap-3">
			<a class="variant-outline btn" href="/my-profile">My profile</a>
			<a class="variant-outline btn" href="/create-forum">Create forum</a>
		</div>
	</header>

	<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
			<label class="block flex-1 space-y-2 text-sm">
				<span class="font-medium">Item ID</span>
				<input class="w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={contentLookupId} placeholder="0x..." />
			</label>
			<a class="btn variant-outline" href={contentLookupId.trim() ? `/item_id/${contentLookupId.trim()}` : '#'} aria-disabled={!contentLookupId.trim()}>
				Open content
			</a>
		</div>
	</section>
</div>
