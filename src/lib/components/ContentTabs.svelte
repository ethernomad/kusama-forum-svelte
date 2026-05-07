<script lang="ts">
	type Props = {
		itemId: string | undefined;
		canEdit?: boolean;
		active: 'view' | 'edit' | 'debug';
	};

	let { itemId, canEdit = false, active }: Props = $props();

	function tabClass(tab: Props['active']): string {
		return tab === active ? 'variant-filled btn' : 'variant-outline btn';
	}
</script>

<nav class="flex gap-2 rounded-xl border border-surface-200-800 bg-surface-50-950 p-2 text-sm">
	<a class={tabClass('view')} href={`/${itemId}`}>View</a>
	{#if canEdit}<a class={tabClass('edit')} href={`/${itemId}/edit`}>Edit</a>{/if}
	<a class={tabClass('debug')} href={`/${itemId}/debug`}>Debug</a>
</nav>
