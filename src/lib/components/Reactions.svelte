<script lang="ts">
	import { Menu } from '@skeletonlabs/skeleton-svelte';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import {
		AVAILABLE_EMOJI_CODEPOINTS,
		fetchReactions,
		optimisticReactionUpdate,
		setReactions,
		type ReactionSummary
	} from '$lib/services/reactions';

	let {
		itemIdHex,
		revisionId
	}: {
		itemIdHex: string;
		revisionId: number;
	} = $props();

	let summaries = $state<ReactionSummary[]>([]);
	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	let requestId = 0;

	const activeCodepoints = $derived(
		summaries.filter((entry) => entry.iReacted).map((entry) => entry.codepoint)
	);
	const pickerEmoji = $derived(
		AVAILABLE_EMOJI_CODEPOINTS.filter((codepoint) => !activeCodepoints.includes(codepoint)).map(
			(codepoint) => ({
				codepoint,
				emoji: String.fromCodePoint(codepoint)
			})
		)
	);
	const reactionsDisabled = $derived(!injectedAccounts.activeAccount || !connections.api || saving);

	function activeSet(): number[] {
		return activeCodepoints;
	}

	async function refresh() {
		const currentRequestId = ++requestId;
		loading = true;
		error = '';
		try {
			const next = await fetchReactions({
				itemIdHex,
				revisionId,
				activeAddress: injectedAccounts.activeAccount?.address ?? null
			});
			if (currentRequestId === requestId) summaries = next;
		} catch (value) {
			if (currentRequestId === requestId) error = value instanceof Error ? value.message : String(value);
		} finally {
			if (currentRequestId === requestId) loading = false;
		}
	}

	$effect(() => {
		void itemIdHex;
		void revisionId;
		void injectedAccounts.activeAccount?.address;
		void refresh();
	});

	async function toggleReaction(codepoint: number) {
		if (!connections.api || !injectedAccounts.activeAccount || saving) return;
		const currentSet = activeSet();
		const nextSet = (currentSet.includes(codepoint)
			? currentSet.filter((entry) => entry !== codepoint)
			: [...currentSet, codepoint]
		).sort((a, b) => a - b);
		const previous = summaries;
		summaries = optimisticReactionUpdate(previous, injectedAccounts.activeAccount.address, nextSet);
		saving = true;
		error = '';
		try {
			await setReactions({
				api: connections.api,
				account: injectedAccounts.activeAccount,
				itemIdHex,
				revisionId,
				reactions: nextSet
			});
			await refresh();
		} catch (value) {
			summaries = previous;
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

<div class="mt-3 space-y-2">
	<div class="flex flex-wrap items-center gap-1.5">
		{#each summaries as summary (summary.codepoint)}
			<button
				type="button"
				class={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition-colors ${summary.iReacted ? 'border-primary-400 bg-primary-500/20 font-semibold text-primary-50' : 'border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900'} ${saving ? 'opacity-70' : ''}`}
				disabled={reactionsDisabled}
				onclick={() => void toggleReaction(summary.codepoint)}
				title={summary.reactors.length ? summary.reactors.join(', ') : 'No reactions yet'}
			>
				<span>{summary.emojiChar}</span>
				<span class="text-xs">{summary.count}</span>
			</button>
		{/each}

		{#if injectedAccounts.activeAccount && connections.api && pickerEmoji.length > 0}
			<Menu positioning={{ placement: 'bottom-start' }}>
				<Menu.Trigger
					class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-surface-300-700 bg-transparent text-sm text-surface-700-300 transition-colors hover:border-primary-400 hover:bg-primary-500/10 hover:text-primary-100"
					disabled={saving}
					aria-label="Add reaction"
				>
					+
				</Menu.Trigger>
				<Menu.Positioner>
					<Menu.Content
						class="border-surface-200-800 bg-surface-50-950 grid max-w-80 grid-cols-6 gap-1 rounded-xl border p-2 shadow-xl"
					>
						{#each pickerEmoji as option (option.codepoint)}
							<Menu.Item
								value={String(option.codepoint)}
								class="hover:bg-surface-100-900 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-xl outline-none"
								disabled={saving}
								onclick={() => void toggleReaction(option.codepoint)}
								title={`React with ${option.emoji}`}
							>
								{option.emoji}
							</Menu.Item>
						{/each}
					</Menu.Content>
				</Menu.Positioner>
			</Menu>
		{/if}
	</div>

	{#if error}
		<p class="text-sm text-red-300">{error}</p>
	{:else if loading}
		<p class="text-xs text-surface-700-300">Loading reactions…</p>
	{:else if !injectedAccounts.activeAccount}
		<p class="text-xs text-surface-700-300">Connect an account to react.</p>
	{/if}
</div>
