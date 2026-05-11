<script lang="ts">
	import { Menu } from '@skeletonlabs/skeleton-svelte';
	import {
		formatAccountLabel,
		formatShortAddress,
		injectedAccounts,
		isVirtoAccount,
		loadInjectedAccounts,
		selectInjectedAccount
	} from '$lib/services/accounts.svelte';
	import { getAccountBalanceLabel } from '$lib/services/balances.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import {
		configureVirto,
		disconnectVirto,
		loginWithVirto,
		registerWithVirto,
		virtoState
	} from '$lib/services/virto-connect.svelte';

	let virtoName = $state(virtoState.displayName);
	let virtoUsername = $state(virtoState.username);

	const activeAccount = $derived(injectedAccounts.activeAccount);
	const extensionAccounts = $derived(
		injectedAccounts.accounts.filter((account) => account.provider === 'extension')
	);
	const virtoAccounts = $derived(
		injectedAccounts.accounts.filter((account) => account.provider === 'virto')
	);

	function syncVirtoConfig(field: 'serverUrl' | 'providerUrl' | 'displayName', value: string) {
		configureVirto({ [field]: value });
	}

	async function refreshAccountsAndSelect(address?: string) {
		await loadInjectedAccounts();
		if (address) selectInjectedAccount(address);
	}

	async function handleVirtoRegister() {
		const result = await registerWithVirto({ username: virtoUsername, name: virtoName });
		await refreshAccountsAndSelect(result.address);
	}

	async function handleVirtoLogin() {
		const result = await loginWithVirto(virtoUsername);
		await refreshAccountsAndSelect(result.address);
	}

	async function handleVirtoDisconnect() {
		disconnectVirto();
		await loadInjectedAccounts();
	}
</script>

<section class="space-y-4 rounded-xl border border-surface-200-800 bg-surface-50-950 p-4">
	<div>
		<p class="mb-3 text-xs font-medium tracking-wide text-surface-700-300 uppercase">
			Active account
		</p>

		<Menu positioning={{ placement: 'bottom-start' }}>
			<Menu.Trigger
				class="inline-flex w-full items-center justify-between gap-3 rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-100-900"
			>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-3">
						<p class="truncate font-medium">{formatAccountLabel(activeAccount)}</p>
						{#if activeAccount}
							<span class="shrink-0 text-xs font-medium text-surface-700-300">
								{getAccountBalanceLabel(activeAccount.address)}
							</span>
						{/if}
					</div>
					<p class="truncate text-xs text-surface-700-300">
						{#if activeAccount}
							{formatShortAddress(activeAccount.address)}
							• {isVirtoAccount(activeAccount) ? 'Virto passkey' : 'Extension'}
						{:else}
							{injectedAccounts.status}
						{/if}
					</p>
				</div>
				<span aria-hidden="true" class="text-xs">▾</span>
			</Menu.Trigger>

			<Menu.Positioner>
				<Menu.Content
					class="w-80 rounded-xl border border-surface-200-800 bg-surface-50-950 p-1 shadow-xl"
				>
					<div class="px-3 py-2">
						<p class="text-xs font-medium">Available accounts</p>
						<p class="mt-1 text-xs text-surface-700-300">{injectedAccounts.status}</p>
					</div>

					{#if extensionAccounts.length > 0}
						<Menu.Separator class="my-1 h-px border-0 bg-surface-200-800" />
						<div
							class="px-3 py-1 text-[11px] font-medium tracking-wide text-surface-700-300 uppercase"
						>
							Extension
						</div>
						{#each extensionAccounts as account (account.address)}
							<Menu.Item
								value={`extension:${account.address}`}
								onclick={() => selectInjectedAccount(account.address)}
								class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm outline-none hover:bg-surface-100-900"
							>
								<span class="w-4 text-center text-xs">
									{account.address === injectedAccounts.activeAddress ? '✓' : ''}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center justify-between gap-3">
										<p class="truncate font-medium">{formatAccountLabel(account)}</p>
										<span class="shrink-0 text-xs font-medium text-surface-700-300">
											{getAccountBalanceLabel(account.address)}
										</span>
									</div>
									<p class="truncate text-xs text-surface-700-300">
										{formatShortAddress(account.address)}
									</p>
									<p class="truncate text-xs text-surface-700-300">
										Source: {account.meta.source ?? 'unknown'}
									</p>
								</div>
							</Menu.Item>
						{/each}
					{/if}

					{#if virtoAccounts.length > 0}
						<Menu.Separator class="my-1 h-px border-0 bg-surface-200-800" />
						<div
							class="px-3 py-1 text-[11px] font-medium tracking-wide text-surface-700-300 uppercase"
						>
							Virto passkey
						</div>
						{#each virtoAccounts as account (account.address)}
							<Menu.Item
								value={`virto:${account.address}`}
								onclick={() => selectInjectedAccount(account.address)}
								class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm outline-none hover:bg-surface-100-900"
							>
								<span class="w-4 text-center text-xs">
									{account.address === injectedAccounts.activeAddress ? '✓' : ''}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center justify-between gap-3">
										<p class="truncate font-medium">{formatAccountLabel(account)}</p>
										<span class="shrink-0 text-xs font-medium text-surface-700-300">
											{getAccountBalanceLabel(account.address)}
										</span>
									</div>
									<p class="truncate text-xs text-surface-700-300">
										{formatShortAddress(account.address)}
									</p>
									<p class="truncate text-xs text-surface-700-300">
										Username: {account.meta.username ?? '—'}
									</p>
								</div>
							</Menu.Item>
						{/each}
					{/if}

					<Menu.Separator class="my-1 h-px border-0 bg-surface-200-800" />
					<Menu.Item
						value="refresh-accounts"
						onclick={() => loadInjectedAccounts()}
						class="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none hover:bg-surface-100-900"
					>
						Refresh accounts
					</Menu.Item>
				</Menu.Content>
			</Menu.Positioner>
		</Menu>
	</div>

	<div class="rounded-xl border border-surface-200-800 p-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-sm font-medium">Virto passkey</p>
				<p class="mt-1 text-xs text-surface-700-300">
					Optional onboarding and signing path using passkeys instead of a browser wallet.
				</p>
			</div>
			{#if virtoState.connected}
				<span
					class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200"
				>
					Connected
				</span>
			{/if}
		</div>

		<div class="mt-3 grid gap-3">
			<label class="grid gap-1 text-xs">
				<span class="text-surface-700-300">Virto server URL</span>
				<input
					class="input"
					value={virtoState.serverUrl}
					oninput={(event) =>
						syncVirtoConfig('serverUrl', (event.currentTarget as HTMLInputElement).value)}
					placeholder="https://vc.connect-test.xyz:5000/api"
				/>
			</label>

			<label class="grid gap-1 text-xs">
				<span class="text-surface-700-300">Blockchain provider URL</span>
				<input
					class="input"
					value={virtoState.providerUrl}
					oninput={(event) =>
						syncVirtoConfig('providerUrl', (event.currentTarget as HTMLInputElement).value)}
					placeholder={connections.endpoint}
				/>
			</label>

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="grid gap-1 text-xs">
					<span class="text-surface-700-300">Display name</span>
					<input
						class="input"
						bind:value={virtoName}
						onchange={() => syncVirtoConfig('displayName', virtoName)}
						placeholder="Forum profile name"
					/>
				</label>
				<label class="grid gap-1 text-xs">
					<span class="text-surface-700-300">Virto username</span>
					<input class="input" bind:value={virtoUsername} placeholder="passkey username" />
				</label>
			</div>
		</div>

		<div class="mt-3 flex flex-wrap gap-2">
			<button
				type="button"
				class="variant-filled-primary btn"
				disabled={virtoState.loading ||
					!virtoUsername.trim() ||
					!virtoState.serverUrl.trim() ||
					!virtoState.providerUrl.trim()}
				onclick={() => void handleVirtoLogin()}
			>
				{virtoState.loading && virtoState.username.trim() === virtoUsername.trim()
					? 'Signing in…'
					: 'Sign in with passkey'}
			</button>
			<button
				type="button"
				class="btn"
				disabled={virtoState.loading ||
					!virtoUsername.trim() ||
					!virtoState.serverUrl.trim() ||
					!virtoState.providerUrl.trim()}
				onclick={() => void handleVirtoRegister()}
			>
				Register passkey
			</button>
			{#if virtoState.connected}
				<button type="button" class="btn" onclick={() => void handleVirtoDisconnect()}>
					Disconnect
				</button>
			{/if}
		</div>

		{#if virtoState.connected}
			<p class="mt-3 text-xs text-surface-700-300">
				Active Virto user: {virtoState.username} • {formatShortAddress(virtoState.address)}
			</p>
		{/if}
		{#if virtoState.providerStatus}
			<p class="mt-2 text-xs text-surface-700-300">Provider: {virtoState.providerStatus}</p>
		{/if}
		{#if virtoState.lastTransactionStatus}
			<p class="mt-2 text-xs text-surface-700-300">
				Last Virto transaction: {virtoState.lastTransactionSummary ||
					virtoState.lastTransactionStatus}
			</p>
		{/if}
		{#if virtoState.error}
			<p class="mt-2 text-sm text-red-300">{virtoState.error}</p>
		{:else}
			<p class="mt-2 text-xs text-surface-700-300">
				Use the same chain endpoint as this dapp unless your Virto backend expects a different
				network.
			</p>
		{/if}
	</div>
</section>
