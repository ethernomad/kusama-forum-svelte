<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { loadInjectedAccounts } from '$lib/services/accounts.svelte';
	import { startAppConnections } from '$lib/services/connections.svelte';

	let { children } = $props();

	onMount(() => {
		loadInjectedAccounts();
		return startAppConnections();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
