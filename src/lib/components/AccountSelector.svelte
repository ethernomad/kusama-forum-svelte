<script lang="ts">
	import { Menu } from '@skeletonlabs/skeleton-svelte';
	import {
		formatAccountLabel,
		formatShortAddress,
		injectedAccounts,
		loadInjectedAccounts,
		selectInjectedAccount
	} from '$lib/services/accounts.svelte';
	import { getAccountBalanceLabel } from '$lib/services/balances.svelte';
</script>

<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
	<p class="mb-3 text-xs font-medium uppercase tracking-wide text-surface-700-300">Active account</p>

	<Menu positioning={{ placement: 'bottom-start' }}>
		<Menu.Trigger
			class="border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900 inline-flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
		>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between gap-3">
					<p class="truncate font-medium">{formatAccountLabel(injectedAccounts.activeAccount)}</p>
					{#if injectedAccounts.activeAccount}
						<span class="text-surface-700-300 shrink-0 text-xs font-medium">
							{getAccountBalanceLabel(injectedAccounts.activeAccount.address)}
						</span>
					{/if}
				</div>
				<p class="text-surface-700-300 truncate text-xs">
					{#if injectedAccounts.activeAccount}
						{formatShortAddress(injectedAccounts.activeAccount.address)}
					{:else}
						{injectedAccounts.status}
					{/if}
				</p>
			</div>
			<span aria-hidden="true" class="text-xs">▾</span>
		</Menu.Trigger>

		<Menu.Positioner>
			<Menu.Content class="border-surface-200-800 bg-surface-50-950 w-80 rounded-xl border p-1 shadow-xl">
				<div class="px-3 py-2">
					<p class="text-xs font-medium">Injected accounts</p>
					<p class="text-surface-700-300 mt-1 text-xs">{injectedAccounts.status}</p>
				</div>

				<Menu.Separator class="bg-surface-200-800 my-1 h-px border-0" />

				{#if injectedAccounts.accounts.length > 0}
					{#each injectedAccounts.accounts as account (account.address)}
						<Menu.Item
							value={account.address}
							onclick={() => selectInjectedAccount(account.address)}
							class="hover:bg-surface-100-900 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm outline-none"
						>
							<span class="w-4 text-center text-xs">
								{account.address === injectedAccounts.activeAddress ? '✓' : ''}
							</span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center justify-between gap-3">
									<p class="truncate font-medium">{formatAccountLabel(account)}</p>
									<span class="text-surface-700-300 shrink-0 text-xs font-medium">
										{getAccountBalanceLabel(account.address)}
									</span>
								</div>
								<p class="text-surface-700-300 truncate text-xs">
									{formatShortAddress(account.address)}
								</p>
								<p class="text-surface-700-300 truncate text-xs">
									Source: {account.meta.source ?? 'unknown'}
								</p>
							</div>
						</Menu.Item>
					{/each}
				{:else}
					<div class="px-3 py-2 text-sm">Install or unlock the Polkadot.js extension to continue.</div>
				{/if}

				<Menu.Separator class="bg-surface-200-800 my-1 h-px border-0" />
				<Menu.Item
					value="refresh-accounts"
					onclick={() => loadInjectedAccounts()}
					class="hover:bg-surface-100-900 cursor-pointer rounded-lg px-3 py-2 text-sm outline-none"
				>
					Refresh accounts
				</Menu.Item>
			</Menu.Content>
		</Menu.Positioner>
	</Menu>
</section>
