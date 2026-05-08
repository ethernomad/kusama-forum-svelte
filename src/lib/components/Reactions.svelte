<script lang="ts">
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

	const allEmoji = AVAILABLE_EMOJI_CODEPOINTS.map((codepoint) => ({
		codepoint,
		emoji: String.fromCodePoint(codepoint)
	}));

	function activeSet(): number[] {
		return summaries.filter((entry) => entry.iReacted).map((entry) => entry.codepoint);
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
		const currentSet = new Set(activeSet());
		if (currentSet.has(codepoint)) currentSet.delete(codepoint);
		else currentSet.add(codepoint);
		const nextSet = [...currentSet].sort((a, b) => a - b);
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

	function summaryFor(codepoint: number): ReactionSummary | undefined {
		return summaries.find((entry) => entry.codepoint === codepoint);
	}
</script>

<div class="mt-3 space-y-2">
	<div class="flex flex-wrap gap-2">
		{#each allEmoji as option (option.codepoint)}
			{@const summary = summaryFor(option.codepoint)}
			<button
				type="button"
				class={`rounded-full border px-2 py-1 text-sm transition-colors ${summary?.iReacted ? 'border-primary-500 bg-primary-500/15' : 'border-surface-200-800 bg-surface-50-950'} ${saving ? 'opacity-70' : ''}`}
				disabled={!injectedAccounts.activeAccount || !connections.api || saving}
				onclick={() => void toggleReaction(option.codepoint)}
				title={summary?.reactors.length ? summary.reactors.join(', ') : 'No reactions yet'}
			>
				<span>{option.emoji}</span>
				{#if summary?.count}
					<span class="ml-1 text-xs">{summary.count}</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if error}
		<p class="text-sm text-red-300">{error}</p>
	{:else if loading}
		<p class="text-xs text-surface-700-300">Loading reactions…</p>
	{:else if !injectedAccounts.activeAccount}
		<p class="text-xs text-surface-700-300">Connect an account to react.</p>
	{/if}
</div>
