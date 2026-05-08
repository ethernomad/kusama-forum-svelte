<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ContentTabs from '$lib/components/ContentTabs.svelte';
	import { formatShortAddress, injectedAccounts } from '$lib/services/accounts.svelte';
	import {
		canEditContent,
		loadContentByItemId,
		publishContentRevision,
		type ContentRevisionDraft,
		type LoadedContent
	} from '$lib/services/content';
	import { connections } from '$lib/services/connections.svelte';
	import { PUBLISH_NOTICE_PREPARING } from '$lib/services/publish-notices';

	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	let notice = $state('');
	let content: LoadedContent | null = $state(null);
	let draft: ContentRevisionDraft = $state({ title: '', body: '' });
	let selectedImageFile: File | null = $state(null);
	let selectedImagePreview: string | null = $state(null);
	let removeImage = $state(false);
	let loadRequest = 0;

	const itemId = $derived(page.params.item_id);
	const activeAccount = $derived(injectedAccounts.activeAccount);
	const canEdit = $derived(canEditContent(content, activeAccount));
	const categoryItemId = $derived.by(() => {
		const value = content;
		return value?.contentType === 'forumPost' ? (value.latestLinks[0] ?? '') : '';
	});

	$effect(() => {
		void itemId;
		const heliaNode = connections.heliaNode;
		if (!heliaNode || !itemId) return;

		const requestId = ++loadRequest;
		loading = true;
		error = '';
		content = null;
		selectedImageFile = null;
		selectedImagePreview = null;
		removeImage = false;
		void loadContentByItemId(heliaNode, itemId, connections.api)
			.then((value) => {
				if (requestId !== loadRequest) return;
				content = value;
				draft = { title: value.title, body: value.bodyText };
				selectedImagePreview = value.imagePreviewDataUrl;
			})
			.catch((value) => {
				if (requestId !== loadRequest) return;
				error = value instanceof Error ? value.message : String(value);
			})
			.finally(() => {
				if (requestId !== loadRequest) return;
				loading = false;
			});
	});

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
		selectedImagePreview = file ? await fileToDataUrl(file) : content?.imagePreviewDataUrl ?? null;
		removeImage = false;
	}

	function clearSelectedImage() {
		selectedImageFile = null;
		selectedImagePreview = null;
		removeImage = true;
	}

	async function submitRevision() {
		error = '';
		notice = '';
		if (!content || !canEdit || !activeAccount) {
			error = 'The active account cannot edit this content item.';
			return;
		}
		if (!connections.api || !connections.heliaNode) {
			error = 'Connect to the chain and start Helia before publishing.';
			return;
		}
		if (!connections.ipfsHasRequiredLocalConnection) {
			error = 'Publishing requires a connection to the local IPFS pinner on one of the default local swarm addresses.';
			return;
		}
		if (!draft.title.trim()) {
			error = 'Title is required.';
			return;
		}

		saving = true;
		try {
			notice = PUBLISH_NOTICE_PREPARING;
			await publishContentRevision({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: activeAccount,
				content,
				draft,
				selectedImageFile,
				removeImage
			});
			notice = 'Revision published. Redirecting...';
			await goto(resolve(`/item_id/${content.itemIdHex}`));
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

<div class="max-w-4xl space-y-6">
	<header
		class="card border-dashed p-6"
	>
		<div>
			<p class="text-sm font-medium text-surface-700-300">Content editor</p>
			<h1 class="mt-1 text-2xl font-semibold">Edit content</h1>
			<p class="mt-2 text-sm break-all text-surface-700-300">{itemId}</p>
		</div>
	</header>

	{#if content}
		<ContentTabs {itemId} {canEdit} active="edit" />
	{/if}

	{#if error}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">
			{error}
		</div>
	{:else if notice}
		<div
			class="card border-emerald-500/40 px-4 py-3 text-sm text-emerald-200"
		>
			{notice}
		</div>
	{/if}

	{#if loading}
		<div class="card px-4 py-3 text-sm">
			Loading content…
		</div>
	{:else if content && !canEdit}
		<div
			class="card border-amber-500/40 px-4 py-3 text-sm text-amber-100"
		>
			This item is not editable by the active account, or it is not revisionable.
		</div>
	{:else if content}
		<section class="card p-6">
			<div class="space-y-4">
				<label class="block space-y-2 text-sm">
					<span class="font-medium">Title</span>
					<input
						class="input w-full"
						bind:value={draft.title}
						disabled={saving}
					/>
				</label>

				{#if content.contentType === 'forumPost'}
					<div class="card p-3 text-sm">
						<p class="text-xs text-surface-700-300 uppercase">Category</p>
						<p class="mt-1 break-all">{categoryItemId || '—'}</p>
						<p class="mt-1 text-xs text-surface-700-300">
							Category is not editable and will be encoded as a link in the new revision.
						</p>
					</div>
				{/if}

				<label class="block space-y-2 text-sm">
					<span class="font-medium">Body</span>
					<textarea
						class="textarea min-h-64 w-full"
						bind:value={draft.body}
						disabled={saving}
					></textarea>
				</label>

				<label class="block space-y-2 text-sm">
					<span class="font-medium">Image</span>
					<input class="input w-full text-sm" type="file" accept="image/*" onchange={handleImageChange} disabled={saving} />
					<p class="text-surface-700-300 text-xs">Leave empty to keep the current image, choose a file to replace it, or remove it entirely.</p>
				</label>

				<div class="card space-y-4 p-4">
					<p class="text-sm font-medium">Image preview</p>
					{#if !removeImage && selectedImagePreview}
						<img src={selectedImagePreview} alt={draft.title || 'Content image preview'} class="max-h-80 rounded-xl object-cover" />
					{:else}
						<div class="bg-surface-100-900 text-surface-700-300 flex aspect-video w-full items-center justify-center rounded-xl text-sm">
							No image
						</div>
					{/if}
					<div class="flex flex-wrap gap-3">
						<button class="btn variant-outline" type="button" onclick={clearSelectedImage} disabled={saving || (removeImage || (!selectedImageFile && !content.imagePreviewDataUrl))}>
							Remove image
						</button>
						<button class="btn variant-outline" type="button" onclick={() => {
							selectedImageFile = null;
							selectedImagePreview = content.imagePreviewDataUrl;
							removeImage = false;
						}} disabled={saving || (!selectedImageFile && !removeImage)}>
							Reset image changes
						</button>
					</div>
				</div>

				<div class="flex flex-wrap gap-3">
					<button
						class="variant-filled-primary btn"
						onclick={submitRevision}
						disabled={!activeAccount || !connections.api || !connections.heliaNode || !connections.ipfsHasRequiredLocalConnection || saving}
					>
						{saving ? 'Publishing...' : 'Publish new revision'}
					</button>
				</div>

				<p class="text-xs text-surface-700-300">
					Author: {activeAccount
						? formatShortAddress(activeAccount.address)
						: 'No account selected'} · {connections.ipfsHasRequiredLocalConnection
						? 'Ready to publish through the local IPFS pinner.'
						: 'Connect to the local IPFS pinner before publishing.'}
				</p>
			</div>
		</section>
	{/if}
</div>
