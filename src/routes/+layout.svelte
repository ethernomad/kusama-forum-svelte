<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import StatusSidebar from '$lib/components/StatusSidebar.svelte';
	import { loadInjectedAccounts, startAccountProfileWatcher } from '$lib/services/accounts.svelte';
	import { startAccountBalanceWatcher } from '$lib/services/balances.svelte';
	import { startAppConnections } from '$lib/services/connections.svelte';
	import { stopIndexer } from '$lib/services/indexer.svelte';

	let { children } = $props();

	onMount(() => {
		loadInjectedAccounts();
		const stopConnections = startAppConnections();
		const stopBalanceWatcher = startAccountBalanceWatcher();
		const stopProfileWatcher = startAccountProfileWatcher();
		return () => {
			stopProfileWatcher();
			stopBalanceWatcher();
			stopConnections();
			stopIndexer();
		};
	});
</script>

<main class="mx-auto max-w-7xl p-6">
	<div class="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
		<aside>
			<StatusSidebar />
		</aside>

		<div class="min-w-0">
			{@render children()}
		</div>
	</div>
</main>
