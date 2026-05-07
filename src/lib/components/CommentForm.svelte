<script lang="ts">
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { saveComment } from '$lib/services/content';

	let {
		parentItemIdHex,
		onPublished,
		label = 'Write a comment'
	}: {
		parentItemIdHex: string;
		onPublished: () => void | Promise<void>;
		label?: string;
	} = $props();

	let body = $state('');
	let saving = $state(false);
	let error = $state('');

	async function publish() {
		if (!connections.api || !connections.heliaNode || !injectedAccounts.activeAccount) return;
		saving = true;
		error = '';
		try {
			await saveComment({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: injectedAccounts.activeAccount,
				parentItemIdHex,
				draft: { body }
			});
			body = '';
			await onPublished();
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

{#if injectedAccounts.activeAccount}
	<form class="mt-3 space-y-2 rounded-lg border border-surface-200-800 bg-surface-100-900 p-3" onsubmit={(event) => { event.preventDefault(); void publish(); }}>
		<label class="block text-sm font-semibold">
			{label}
			<textarea class="mt-2 min-h-24 w-full rounded-lg border-surface-200-800 bg-surface-50-950" bind:value={body} placeholder="Comment body" disabled={saving} required></textarea>
		</label>
		{#if error}<p class="text-sm text-red-300">{error}</p>{/if}
		<button class="btn variant-filled" type="submit" disabled={saving || !body.trim()}>{saving ? 'Publishing…' : 'Publish comment'}</button>
	</form>
{:else}
	<p class="mt-3 text-sm text-surface-700-300">Connect an account to comment.</p>
{/if}
