<script lang="ts">
	import { resolve } from '$app/paths';

	type Props = {
		itemId: string | undefined;
		canEdit?: boolean;
		active: 'view' | 'edit' | 'debug';
	};

	let { itemId, canEdit = false, active }: Props = $props();

	function tabClass(tab: Props['active']): string {
		return tab === active
			? 'variant-filled btn border-primary-500/60 bg-primary-500 text-primary-content shadow-sm'
			: 'variant-outline btn border-transparent bg-transparent text-surface-700-300 hover:border-surface-300-600 hover:bg-surface-100-900';
	}
</script>

<nav class="flex w-fit gap-2 rounded-xl border border-surface-200-800 bg-surface-50-950 p-2 text-sm" aria-label="Content tabs">
	<a class={tabClass('view')} aria-current={active === 'view' ? 'page' : undefined} href={resolve(`/item_id/${itemId}`)}>View</a>
	{#if canEdit}<a class={tabClass('edit')} aria-current={active === 'edit' ? 'page' : undefined} href={resolve(`/item_id/${itemId}/edit`)}>Edit</a>{/if}
	<a class={tabClass('debug')} aria-current={active === 'debug' ? 'page' : undefined} href={resolve(`/item_id/${itemId}/debug`)}>Debug</a>
</nav>
