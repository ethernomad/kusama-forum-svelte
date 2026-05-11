<script lang="ts">
	import { resolve } from '$app/paths';
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import {
		fetchTrustedAccounts,
		loadTrustedAccountSummaries,
		untrustAccount,
		type TrustedAccountSummary
	} from '$lib/services/trusted-accounts';

	let loading = $state(false);
	let error = $state('');
	let removeError = $state('');
	let removingAddress = $state('');
	let trustedAccounts = $state<TrustedAccountSummary[]>([]);
	let refreshNonce = $state(0);

	const activeAccount = $derived(injectedAccounts.activeAccount);
	const activeAddress = $derived(activeAccount?.address ?? '');

	async function refreshTrustedAccounts() {
		error = '';
		removeError = '';

		if (!connections.api || !activeAddress) {
			trustedAccounts = [];
			return;
		}

		loading = true;
		try {
			const addresses = await fetchTrustedAccounts(connections.api, activeAddress);
			trustedAccounts = await loadTrustedAccountSummaries(connections.api, addresses);
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
			trustedAccounts = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void activeAddress;
		void connections.api;
		void refreshNonce;
		void refreshTrustedAccounts();
	});

	async function handleRemove(address: string) {
		if (!connections.api || !activeAccount) return;
		removeError = '';
		removingAddress = address;
		try {
			await untrustAccount(connections.api, activeAccount, address);
			refreshNonce += 1;
		} catch (value) {
			removeError = value instanceof Error ? value.message : String(value);
		} finally {
			removingAddress = '';
		}
	}
</script>

<div class="max-w-4xl space-y-6">
	<header class="card border-dashed p-6">
		<p class="text-sm font-medium text-surface-700-300">Social graph</p>
		<h1 class="mt-1 text-2xl font-semibold">Trusted Accounts</h1>
		<p class="mt-2 text-sm text-surface-700-300">
			Accounts directly trusted by your currently selected account. This list is read from chain
			storage.
		</p>
	</header>

	{#if error}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">{error}</div>
	{/if}

	{#if removeError}
		<div class="card border-red-500/40 px-4 py-3 text-sm text-red-200">{removeError}</div>
	{/if}

	<section class="card p-6">
		{#if !activeAccount}
			<p class="text-sm text-surface-700-300">Select an account to view trusted accounts.</p>
		{:else if loading}
			<p class="text-sm">Loading trusted accounts…</p>
		{:else if trustedAccounts.length === 0}
			<p class="text-sm text-surface-700-300">
				This account does not currently trust any accounts.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="table w-full text-sm">
					<thead>
						<tr>
							<th class="text-left">Account</th>
							<th class="text-left">Address</th>
							<th class="text-right">Action</th>
						</tr>
					</thead>
					<tbody>
						{#each trustedAccounts as account (account.address)}
							<tr>
								<td>
									{#if account.profileItemIdHex}
										<a class="anchor" href={resolve(`/item_id/${account.profileItemIdHex}`)}>
											{account.displayName}
										</a>
									{:else}
										{account.displayName}
									{/if}
								</td>
								<td><code class="text-xs">{account.address}</code></td>
								<td class="text-right">
									<button
										type="button"
										class="variant-soft btn-sm"
										disabled={removingAddress === account.address}
										onclick={() => void handleRemove(account.address)}
									>
										{removingAddress === account.address ? 'Removing…' : 'Remove'}
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
