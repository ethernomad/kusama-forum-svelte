<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatShortAddress, injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { saveForum, type ForumDraft } from '$lib/services/content';
	import { PUBLISH_NOTICE_PREPARING } from '$lib/services/publish-notices';

	let draft: ForumDraft = $state({
		title: '',
		description: ''
	});
	let selectedImageFile: File | null = $state(null);
	let selectedImagePreview: string | null = $state(null);
	let saving = $state(false);
	let error = $state('');
	let notice = $state('');

	const activeAccount = $derived(injectedAccounts.activeAccount);

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

	async function submitForum() {
		error = '';
		notice = '';

		if (!activeAccount) {
			error = 'Select an account before creating a forum.';
			return;
		}
		if (!connections.api) {
			error = 'Connect to the chain before creating a forum.';
			return;
		}
		if (!connections.ipfsConnected) {
			error = 'Connect to the local IPFS daemon before creating a forum.';
			return;
		}
		if (!draft.title.trim()) {
			error = 'Forum title is required.';
			return;
		}

		saving = true;
		notice = PUBLISH_NOTICE_PREPARING;
		try {
			const saved = await saveForum({
				api: connections.api,
				account: activeAccount,
				draft,
				selectedImageFile
			});
			notice = 'Forum created successfully. Redirecting...';
			await goto(resolve(`/item_id/${saved.itemIdHex}`));
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

<div class="max-w-4xl space-y-6">
	<header class="mb-6 flex flex-wrap items-start justify-between gap-4 card border-dashed p-6">
		<div>
			<p class="text-sm font-medium text-surface-700-300">Top-level content item</p>
			<h1 class="mt-1 text-2xl font-semibold">Create a forum</h1>
			<p class="mt-2 max-w-2xl text-sm text-surface-700-300">
				Anyone can create a forum content item. The item is published to IPFS and then to the chain.
			</p>
		</div>
	</header>

	{#if error}
		<div class="mb-6 card border-red-500/40 px-4 py-3 text-sm text-red-200">{error}</div>
	{:else if notice}
		<div class="mb-6 card border-emerald-500/40 px-4 py-3 text-sm text-emerald-200">{notice}</div>
	{/if}

	<section class="card p-6">
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div class="space-y-4">
				<label class="block space-y-2 text-sm">
					<span class="font-medium">Forum title</span>
					<input
						class="input w-full"
						bind:value={draft.title}
						placeholder="Kusama Governance"
						disabled={saving}
					/>
				</label>

				<label class="block space-y-2 text-sm">
					<span class="font-medium">Description</span>
					<textarea
						class="textarea min-h-48 w-full"
						bind:value={draft.description}
						placeholder="What is this forum about?"
						disabled={saving}
					></textarea>
				</label>

				<label class="block space-y-2 text-sm">
					<span class="font-medium">Forum image</span>
					<input
						class="input w-full text-sm"
						type="file"
						accept="image/*"
						onchange={handleImageChange}
						disabled={saving}
					/>
					<p class="text-xs text-surface-700-300">
						Images are re-encoded to JPEG and uploaded to IPFS as mipmap levels before publishing
						the forum item.
					</p>
				</label>

				<div class="flex flex-wrap gap-3">
					<button
						class="variant-filled-primary btn"
						onclick={submitForum}
						disabled={!activeAccount || !connections.api || !connections.ipfsConnected || saving}
					>
						{#if saving}
							Creating...
						{:else}
							Create forum
						{/if}
					</button>
				</div>
			</div>

			<aside class="space-y-4 card p-4">
				<p class="text-sm font-medium">Preview</p>
				{#if selectedImagePreview}
					<img
						src={selectedImagePreview}
						alt={draft.title.trim() || 'Forum image preview'}
						class="aspect-video w-full rounded-xl object-cover"
					/>
				{:else}
					<div
						class="flex aspect-video w-full items-center justify-center rounded-xl bg-surface-100-900 text-sm text-surface-700-300"
					>
						No image
					</div>
				{/if}
				<div>
					<h2 class="text-lg font-semibold">{draft.title.trim() || 'Untitled forum'}</h2>
					<p class="mt-2 text-sm whitespace-pre-wrap text-surface-700-300">
						{draft.description.trim() || 'No description yet.'}
					</p>
				</div>
				<div class="space-y-1 text-xs text-surface-700-300">
					<p>
						Author: {activeAccount
							? formatShortAddress(activeAccount.address)
							: 'No account selected'}
					</p>
					<p>
						{connections.ipfsConnected
							? 'Ready to publish through the local IPFS daemon.'
							: 'Connect to the local IPFS daemon before publishing.'}
					</p>
				</div>
			</aside>
		</div>
	</section>
</div>
