<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import { loadInjectedAccounts } from '$lib/services/accounts.svelte';
	import { startAccountBalanceWatcher } from '$lib/services/balances.svelte';
	import { startAppConnections } from '$lib/services/connections.svelte';
	import { stopIndexer } from '$lib/services/indexer.svelte';

	let { children } = $props();

	onMount(() => {
		loadInjectedAccounts();
		const stopConnections = startAppConnections();
		const stopBalanceWatcher = startAccountBalanceWatcher();
		return () => {
			stopBalanceWatcher();
			stopConnections();
			stopIndexer();
		};
	});
</script>

{@render children()}
