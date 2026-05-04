<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { startAppConnections } from '$lib/services/connections.svelte';

	let { children } = $props();

	onMount(() => startAppConnections());
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
