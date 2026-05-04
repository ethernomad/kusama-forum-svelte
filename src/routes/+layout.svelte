<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
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

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
