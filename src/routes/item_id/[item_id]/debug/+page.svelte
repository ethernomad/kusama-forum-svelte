<script lang="ts">
	import { page } from '$app/state';
	import ContentTabs from '$lib/components/ContentTabs.svelte';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import {
		canEditContent,
		loadContentByItemId,
		loadContentItemDebug,
		loadRevisionDebug,
		shortHex,
		type ContentItemDebug,
		type LoadedContent,
		type RevisionDebug
	} from '$lib/services/content';
	import { connections } from '$lib/services/connections.svelte';

	const FLAG_DEFS = [
		{ bit: 1 << 0, label: 'Revisionable', description: 'New revisions are allowed.' },
		{ bit: 1 << 1, label: 'Retractable', description: 'Item can be marked retracted.' },
		{ bit: 1 << 2, label: 'Retracted', description: 'Set by retract_item.' }
	] as const;

	let loading = $state(false);
	let revisionLoading = $state(false);
	let error = $state('');
	let revisionError = $state('');
	let debug: ContentItemDebug | null = $state(null);
	let content: LoadedContent | null = $state(null);
	let revision: RevisionDebug | null = $state(null);
	let selectedRevisionId = $state('');
	let copied = $state(false);
	let requestId = 0;
	let revisionRequestId = 0;

	const itemId = $derived(page.params.item_id);
	const canEdit = $derived(canEditContent(debug, injectedAccounts.activeAccount));

	function isFlagEnabled(flags: number | null, bit: number): boolean {
		return flags != null && (flags & bit) !== 0;
	}

	async function copyItemId() {
		if (!itemId) {
			copied = false;
			return;
		}
		try {
			await navigator.clipboard.writeText(itemId);
			copied = true;
			window.setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			copied = false;
		}
	}

	$effect(() => {
		void itemId;
		selectedRevisionId = '';
		copied = false;
		debug = null;
		content = null;
		revision = null;
	});

	$effect(() => {
		const heliaNode = connections.ipfsConnected;
		void itemId;
		if (!heliaNode || !itemId) return;
		const currentRequestId = ++requestId;
		loading = true;
		error = '';
		debug = null;
		content = null;
		revision = null;
		void Promise.all([
			loadContentItemDebug(itemId, connections.api),
			loadContentByItemId(itemId, connections.api)
		])
			.then(([debugValue, contentValue]) => {
				if (currentRequestId !== requestId) return;
				debug = debugValue;
				content = contentValue;
				selectedRevisionId = String(debugValue.latestRevisionId ?? debugValue.revisions[0]?.revisionId ?? '');
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
		const heliaNode = connections.ipfsConnected;
		const value = debug;
		void selectedRevisionId;
		if (!heliaNode || !value || !selectedRevisionId) return;
		const selected = value.revisions.find(
			(entry) => entry.revisionId === Number(selectedRevisionId)
		);
		if (!selected) return;
		const currentRequestId = ++revisionRequestId;
		revisionLoading = true;
		revisionError = '';
		revision = null;
		void loadRevisionDebug(selected)
			.then((loaded) => {
				if (currentRequestId !== revisionRequestId) return;
				revision = loaded;
			})
			.catch((value) => {
				if (currentRequestId !== revisionRequestId) return;
				revisionError = value instanceof Error ? value.message : String(value);
			})
			.finally(() => {
				if (currentRequestId !== revisionRequestId) return;
				revisionLoading = false;
			});
	});
</script>

<div class="max-w-5xl space-y-6">
	<header
		class="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-surface-200-800 p-6"
	>
		<div>
			<h1 class="text-2xl font-semibold">{content?.title || 'Loading item…'}</h1>
		</div>
	</header>

	{#if debug}
		<div class="space-y-3 px-6">
			<ContentTabs {itemId} {canEdit} active="debug" />
			<div class="flex flex-wrap items-center gap-2">
				<div class="inline-flex max-w-full rounded-full border border-surface-200-800 bg-surface-100-900 px-3 py-1 text-xs font-mono break-all text-surface-700-300">
					{itemId}
				</div>
				<button
					type="button"
					class="variant-outline btn btn-sm"
					onclick={copyItemId}
					aria-label="Copy item ID"
				>
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
		</div>
	{/if}

	{#if loading}
		<div class="card px-4 py-3 text-sm">Loading debug data…</div>
	{:else if error}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">{error}</div>
	{:else if debug}
		<section class="card p-6 text-sm">
			<h2 class="text-lg font-semibold">Chain state</h2>
			<div class="mt-4 grid gap-4 md:grid-cols-3">
				<div>
					<p class="text-xs text-surface-700-300 uppercase">Owner</p>
					<code class="break-all">{debug.ownerHex ?? '—'}</code>
				</div>
				<div>
					<p class="text-xs text-surface-700-300 uppercase">Latest revision</p>
					<p>{debug.latestRevisionId ?? '—'}</p>
				</div>
				<div>
					<p class="text-xs text-surface-700-300 uppercase">Flags</p>
					<p>{debug.flags ?? '—'} {debug.flags != null ? `(0x${debug.flags.toString(16)})` : ''}</p>
					{#if debug.flags != null}
						<div class="mt-3 flex flex-wrap gap-2">
							{#each FLAG_DEFS as flag (flag.bit)}
								<span
									class={[
										'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
										isFlagEnabled(debug.flags, flag.bit)
											? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
											: 'border-surface-200-800 bg-surface-100-900 text-surface-700-300'
									]}
									title={flag.description}
								>
									<span
										class={[
											'h-2 w-2 rounded-full',
											isFlagEnabled(debug.flags, flag.bit) ? 'bg-emerald-400' : 'bg-surface-500'
										]}
									></span>
									<span>{flag.label}</span>
									<span class="opacity-80"
										>{isFlagEnabled(debug.flags, flag.bit) ? 'enabled' : 'disabled'}</span
									>
								</span>
							{/each}
						</div>
					{/if}
				</div>
			</div>
			<div class="mt-4">
				<p class="text-xs text-surface-700-300 uppercase">Parents from PublishItem</p>
				{#if debug.parents.length}<ul class="mt-1 list-disc space-y-1 pl-5">
						{#each debug.parents as parent (parent)}<li>
								<code class="break-all">{parent}</code>
							</li>{/each}
					</ul>{:else}<p>—</p>{/if}
			</div>
		</section>

		<section class="card p-6 text-sm">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-lg font-semibold">Revision</h2>
				<select class="select w-56" bind:value={selectedRevisionId} aria-label="Select revision">
					{#each debug.revisions as entry (entry.revisionId)}
						<option value={String(entry.revisionId)}
							>Revision {entry.revisionId}{entry.revisionId === debug.latestRevisionId
								? ' (latest)'
								: ''}</option
						>
					{/each}
				</select>
			</div>

			{#if revisionLoading}
				<p class="mt-4">Loading revision IPFS content…</p>
			{:else if revisionError}
				<div class="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
					{revisionError}
				</div>
			{:else if revision}
				<div class="mt-4 grid gap-4 md:grid-cols-2">
					<div>
						<p class="text-xs text-surface-700-300 uppercase">IPFS CID</p>
						<code class="break-all">{revision.cid}</code>
					</div>
					<div>
						<p class="text-xs text-surface-700-300 uppercase">Content type</p>
						<p>{revision.contentTypeId} / {revision.contentTypeName}</p>
					</div>
					<div>
						<p class="text-xs text-surface-700-300 uppercase">Links</p>
						<p>{revision.links.length ? revision.links.map(shortHex).join(', ') : '—'}</p>
					</div>
					<div>
						<p class="text-xs text-surface-700-300 uppercase">Mentions</p>
						<p>{revision.mentions.length ? revision.mentions.map(shortHex).join(', ') : '—'}</p>
					</div>
				</div>

				<div class="mt-6 space-y-4">
					<h3 class="font-semibold">Decoded mixins</h3>
					{#each revision.mixins as mixin (mixin.mixinId)}
						<article class="rounded-lg border border-surface-200-800 p-4">
							<p class="font-medium">{mixin.mixinId} / {mixin.name}</p>
							<p class="mt-1 text-xs text-surface-700-300">
								0x{mixin.mixinId.toString(16).padStart(8, '0')}
							</p>
							<pre
								class="mt-3 overflow-x-auto rounded bg-surface-100-900 p-3 text-xs">{JSON.stringify(
									mixin.data,
									null,
									2
								)}</pre>
							<details class="mt-2">
								<summary class="cursor-pointer text-xs text-surface-700-300">Raw payload</summary
								><code class="mt-2 block text-xs break-all">{mixin.rawHex}</code>
							</details>
						</article>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>
