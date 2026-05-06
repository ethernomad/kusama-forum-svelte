<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		formatAccountLabel,
		formatShortAddress,
		injectedAccounts,
		loadInjectedAccounts,
		selectInjectedAccount
	} from '$lib/services/accounts.svelte';
	import { getAccountBalanceLabel } from '$lib/services/balances.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { prepareForumSave, saveForum, type ForumDraft, type PreparedForumSave } from '$lib/services/content';
	import { AppBar, Menu } from '@skeletonlabs/skeleton-svelte';

	let draft: ForumDraft = $state({
		title: '',
		description: ''
	});
	let saving = $state(false);
	let preparing = $state(false);
	let prepared: PreparedForumSave | null = $state(null);
	let error = $state('');
	let notice = $state('');
	let prepareRequest = 0;

	const activeAccount = $derived(injectedAccounts.activeAccount);

	$effect(() => {
		void draft.title;
		void draft.description;
		const heliaNode = connections.heliaNode;
		if (!heliaNode) {
			prepared = null;
			preparing = false;
			return;
		}

		const requestId = ++prepareRequest;
		preparing = true;
		prepared = null;
		const timer = setTimeout(() => {
			void prepareForumSave({ heliaNode, draft: { ...draft } })
				.then((value) => {
					if (requestId !== prepareRequest) return;
					prepared = value;
				})
				.catch(() => {
					if (requestId !== prepareRequest) return;
					prepared = null;
				})
				.finally(() => {
					if (requestId !== prepareRequest) return;
					preparing = false;
				});
		}, 300);

		return () => clearTimeout(timer);
	});

	async function submitForum() {
		error = '';
		notice = '';

		if (!activeAccount) {
			error = 'Select an account before creating a forum.';
			return;
		}
		if (!connections.api) {
			error = 'Connect to the chain before creating a forum.';
			return;
		}
		if (!connections.heliaNode) {
			error = 'Start the in-browser Helia node before creating a forum.';
			return;
		}
		if (!draft.title.trim()) {
			error = 'Forum title is required.';
			return;
		}
		if (preparing || !prepared) {
			notice = 'Preparing IPFS payload in the background. Try again in a moment.';
			return;
		}

		saving = true;
		try {
			const saved = await saveForum({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: activeAccount,
				draft,
				prepared
			});
			notice = 'Forum created successfully. Redirecting...';
			await goto(`/${saved.itemIdHex}`);
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			saving = false;
		}
	}
</script>

<AppBar class="px-6">
	<div class="flex items-center justify-between gap-4 py-4">
		<div class="flex items-center gap-3">
			<a href="/" class="text-sm font-semibold">Kusama Forum</a>
			<span class="text-surface-700-300 text-sm">Create forum</span>
		</div>

		<Menu positioning={{ placement: 'bottom-end' }}>
			<Menu.Trigger
				class="border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900 inline-flex min-w-56 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
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
	</div>
</AppBar>

<main class="mx-auto max-w-4xl p-6">
	<header class="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-surface-200-800 p-6">
		<div>
			<p class="text-surface-700-300 text-sm font-medium">Top-level content item</p>
			<h1 class="mt-1 text-2xl font-semibold">Create a forum</h1>
			<p class="text-surface-700-300 mt-2 max-w-2xl text-sm">
				Anyone can create a forum content item. The item is published to IPFS and then to the chain.
			</p>
		</div>
		<div class="flex gap-3">
			<a class="btn variant-outline" href="/">Profile</a>
		</div>
	</header>

	{#if error}
		<div class="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
	{:else if notice}
		<div class="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>
	{/if}

	<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-6">
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div class="space-y-4">
				<label class="block space-y-2 text-sm">
					<span class="font-medium">Forum title</span>
					<input class="w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={draft.title} placeholder="Kusama Governance" disabled={saving} />
				</label>

				<label class="block space-y-2 text-sm">
					<span class="font-medium">Description</span>
					<textarea class="min-h-48 w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={draft.description} placeholder="What is this forum about?" disabled={saving}></textarea>
				</label>

				<div class="flex flex-wrap gap-3">
					<button class="btn variant-filled-primary" onclick={submitForum} disabled={!activeAccount || !connections.api || !connections.heliaNode || saving}>
						{#if saving}
							Creating...
						{:else}
							Create forum
						{/if}
					</button>
					<a class="btn variant-outline" href="/">Cancel</a>
				</div>
			</div>

			<aside class="space-y-4 rounded-xl border border-surface-200-800 p-4">
				<p class="text-sm font-medium">Preview</p>
				<div>
					<h2 class="text-lg font-semibold">{draft.title.trim() || 'Untitled forum'}</h2>
					<p class="text-surface-700-300 mt-2 text-sm whitespace-pre-wrap">{draft.description.trim() || 'No description yet.'}</p>
				</div>
				<div class="text-surface-700-300 space-y-1 text-xs">
					<p>Author: {activeAccount ? formatShortAddress(activeAccount.address) : 'No account selected'}</p>
					<p>{preparing ? 'Preparing IPFS revision…' : prepared ? 'IPFS revision ready.' : 'Waiting for input…'}</p>
				</div>
			</aside>
		</div>
	</section>
</main>
