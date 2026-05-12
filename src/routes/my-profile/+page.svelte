<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MyProfilePage from '$lib/components/MyProfilePage.svelte';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { loadProfileMetadata } from '$lib/services/profile';

	const activeAddress = $derived(injectedAccounts.activeAccount?.address ?? '');

	let profileCheckRequest = 0;
	let redirectCheckComplete = $state(false);

	$effect(() => {
		void connections.api;
		void activeAddress;

		const api = connections.api;
		const address = activeAddress;
		const requestId = ++profileCheckRequest;
		redirectCheckComplete = !api || !address;

		if (!api || !address) return;

		void loadProfileMetadata(api, address)
			.then(async (profile) => {
				if (requestId !== profileCheckRequest) return;
				if (profile.exists && profile.itemIdHex) {
					await goto(resolve(`/item_id/${profile.itemIdHex}`), { replaceState: true });
					return;
				}
				redirectCheckComplete = true;
			})
			.catch(() => {
				if (requestId !== profileCheckRequest) return;
				redirectCheckComplete = true;
			});
	});
</script>

{#if redirectCheckComplete}
	<MyProfilePage />
{:else}
	<div class="card p-6 text-sm text-surface-700-300">Checking for an existing profile…</div>
{/if}
