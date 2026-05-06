<script lang="ts">
	import { AppBar, Menu } from '@skeletonlabs/skeleton-svelte';
	import {
		formatAccountLabel,
		formatShortAddress,
		injectedAccounts,
		loadInjectedAccounts,
		selectInjectedAccount
	} from '$lib/services/accounts.svelte';
	import { getAccountBalanceLabel } from '$lib/services/balances.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import { ipfsProvideStatus } from '$lib/services/ipfs-provide-status.svelte';
	import {
		loadProfileContent,
		loadProfileMetadata,
		prepareProfileSave,
		saveProfile,
		ipfsDigestHexToCid,
		shortHex,
		type LoadedProfile,
		type PreparedProfileSave,
		type ProfileDraft
	} from '$lib/services/profile';

	const isConnected = (status: string) =>
		status === 'Connected' || status.startsWith('Running in browser') || status.startsWith('Connected to global IPFS');

	const accountTypeOptions = [
		{ value: 0, label: 'Anon' },
		{ value: 1, label: 'Person' },
		{ value: 2, label: 'Project' },
		{ value: 3, label: 'Organization' },
		{ value: 4, label: 'Proxy' },
		{ value: 5, label: 'Parody' },
		{ value: 6, label: 'Bot' },
		{ value: 7, label: 'Shill' },
		{ value: 8, label: 'Test' }
	];

	let profile: LoadedProfile | null = $state(null);
	let draft: ProfileDraft = $state({
		name: '',
		bio: '',
		location: '',
		accountType: 0
	});
	let existingImagePayload: Uint8Array | null = $state(null);
	let selectedImageFile: File | null = $state(null);
	let selectedImagePreview: string | null = $state(null);
	let loadingProfile = $state(false);
	let savingProfile = $state(false);
	let preparingProfileSave = $state(false);
	let preparedProfileSave: PreparedProfileSave | null = $state(null);
	let profileError = $state('');
	let profileNotice = $state('');
	let refreshTick = $state(0);
	let profileLoadRequest = 0;
	let prepareProfileRequest = 0;

	const activeAccount = $derived(injectedAccounts.activeAccount);
	const activeAddress = $derived(activeAccount?.address ?? '');
	const activeAccountTypeLabel = $derived(
		accountTypeOptions.find((option) => option.value === draft.accountType)?.label ?? 'Anon'
	);
	const ipfsProvideMessage = $derived.by(() => {
		if (ipfsProvideStatus.pending > 0) {
			return `Advertising ${ipfsProvideStatus.pending} IPFS item${ipfsProvideStatus.pending === 1 ? '' : 's'}...`;
		}
		if (ipfsProvideStatus.lastError) {
			return `IPFS advertisement failed: ${ipfsProvideStatus.lastError}`;
		}
		if (ipfsProvideStatus.lastCompletedAt) {
			return `Last IPFS advertisement completed at ${new Date(ipfsProvideStatus.lastCompletedAt).toLocaleTimeString()}.`;
		}
		return 'Idle.';
	});

	function applyProfile(next: LoadedProfile) {
		profile = next;
		draft = { ...next.draft };
		existingImagePayload = next.existingImagePayload;
		selectedImageFile = null;
		selectedImagePreview = null;
	}

	async function refreshProfile() {
		profileError = '';
		profileNotice = '';
		selectedImageFile = null;
		selectedImagePreview = null;

		if (!activeAddress || !connections.api || !connections.heliaNode) {
			profile = null;
			draft = { name: '', bio: '', location: '', accountType: 0 };
			existingImagePayload = null;
			return;
		}

		const requestId = ++profileLoadRequest;
		loadingProfile = true;
		try {
			const metadata = await loadProfileMetadata(connections.api, activeAddress);
			if (requestId !== profileLoadRequest) return;
			applyProfile(metadata);
			if (!metadata.exists) {
				profileNotice = 'No profile exists yet for this account.';
				return;
			}

			profileNotice = 'Loaded on-chain profile metadata. Refreshing indexed/IPFS content in the background...';
			void loadProfileContent(connections.heliaNode, metadata)
				.then((loaded) => {
					if (requestId !== profileLoadRequest) return;
					applyProfile(loaded);
					if (!loaded.contentLoaded) {
						profileNotice = 'Loaded on-chain profile metadata, but the revision content could not be fetched from IPFS.';
						profileError = loaded.contentError ?? '';
					} else {
						profileNotice = 'Loaded the latest indexed profile revision.';
					}
				})
				.catch((error) => {
					if (requestId !== profileLoadRequest) return;
					profileNotice = 'Loaded on-chain profile metadata, but the revision content could not be fetched from IPFS.';
					profileError = error instanceof Error ? error.message : String(error);
				})
				.finally(() => {
					if (requestId !== profileLoadRequest) return;
					loadingProfile = false;
				});
		} catch (error) {
			if (requestId !== profileLoadRequest) return;
			profile = null;
			existingImagePayload = null;
			profileError = error instanceof Error ? error.message : String(error);
			loadingProfile = false;
		}
	}

	$effect(() => {
		void activeAddress;
		void connections.api;
		void refreshTick;
		void refreshProfile();
	});

	async function handleImageChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		selectedImageFile = file;
		selectedImagePreview = file ? await fileToDataUrl(file) : null;
	}

	async function fileToDataUrl(file: File) {
		return await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result ?? ''));
			reader.onerror = () => reject(reader.error ?? new Error('Failed to read image.'));
			reader.readAsDataURL(file);
		});
	}

	$effect(() => {
		void draft.name;
		void draft.bio;
		void draft.location;
		void draft.accountType;
		void selectedImageFile;
		void existingImagePayload;
		void profile?.itemIdHex;
		const heliaNode = connections.heliaNode;
		if (!heliaNode) {
			preparedProfileSave = null;
			preparingProfileSave = false;
			return;
		}

		const requestId = ++prepareProfileRequest;
		preparingProfileSave = true;
		preparedProfileSave = null;
		const timer = setTimeout(() => {
			void prepareProfileSave({
				heliaNode,
				draft: { ...draft },
				existingItemIdHex: profile?.itemIdHex ?? null,
				existingImagePayload,
				selectedImageFile
			})
				.then((prepared) => {
					if (requestId !== prepareProfileRequest) return;
					preparedProfileSave = prepared;
				})
				.catch(() => {
					if (requestId !== prepareProfileRequest) return;
					preparedProfileSave = null;
				})
				.finally(() => {
					if (requestId !== prepareProfileRequest) return;
					preparingProfileSave = false;
				});
		}, 300);

		return () => {
			clearTimeout(timer);
		};
	});

	async function submitProfile() {
		profileError = '';
		profileNotice = '';

		if (!activeAccount) {
			profileError = 'Select an account before saving a profile.';
			return;
		}
		if (!connections.api) {
			profileError = 'Connect to the chain before saving a profile.';
			return;
		}
		if (!connections.heliaNode) {
			profileError = 'Start the in-browser Helia node before saving a profile.';
			return;
		}
		if (preparingProfileSave || !preparedProfileSave) {
			profileNotice = 'Preparing IPFS payload in the background. Transaction signing will be available as soon as preparation completes.';
			return;
		}

		savingProfile = true;
		try {
			const saved = await saveProfile({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: activeAccount,
				draft,
				existingItemIdHex: profile?.itemIdHex ?? null,
				existingImagePayload,
				selectedImageFile,
				prepared: preparedProfileSave
			});
			applyProfile(saved);
			preparedProfileSave = null;
			profileNotice = saved.itemIdHex === profile?.itemIdHex ? 'Profile revision published successfully.' : 'Profile created successfully.';
		} catch (error) {
			profileError = error instanceof Error ? error.message : String(error);
		} finally {
			savingProfile = false;
		}
	}
</script>

<AppBar class="px-6">
	<div class="flex items-center justify-between gap-4 py-4">
		<div class="flex items-center gap-3">
			<span class="text-sm font-semibold">Kusama Forum</span>
			<span class="text-surface-700-300 text-sm">Profile publisher</span>
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
	</div>
</AppBar>

<main class="mx-auto max-w-7xl p-6">
	<div class="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
		<aside class="space-y-6 xl:sticky xl:top-6 xl:self-start">
			<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
				<h2 class="mb-3 text-base font-medium">Connections</h2>
				<div class="space-y-3 text-sm">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-3">
							<span class={`h-3 w-3 rounded-full ${isConnected(connections.status) ? 'bg-green-500' : 'bg-red-500'}`}></span>
							<span class="font-medium">Chain</span>
						</div>
						<span class="text-surface-700-300">{#if connections.latestBlockNumber}#{connections.latestBlockNumber}{:else}—{/if}</span>
					</div>

					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-3">
							<span class={`h-3 w-3 rounded-full ${isConnected(connections.indexerStatus) ? 'bg-green-500' : 'bg-red-500'}`}></span>
							<span class="font-medium">Indexer</span>
						</div>
						<span class="text-surface-700-300">{#if connections.indexerLatestBlockNumber}#{connections.indexerLatestBlockNumber}{:else}—{/if}</span>
					</div>

					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-3">
							<span class={`h-3 w-3 rounded-full ${isConnected(connections.ipfsStatus) ? 'bg-green-500' : 'bg-red-500'}`}></span>
							<span class="font-medium">IPFS</span>
						</div>
						<span class="text-surface-700-300">{connections.ipfsConnections}</span>
					</div>
				</div>
			</section>

			<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4 text-sm">
				<h2 class="mb-2 text-base font-medium">Profile status</h2>
				<p class="text-surface-700-300">Profiles are encoded as the same protobuf item payload used by acuity-dioxus before publishing to IPFS and the chain.</p>
				<p class={`mt-3 text-xs ${ipfsProvideStatus.lastError ? 'text-red-300' : 'text-surface-700-300'}`}>{ipfsProvideMessage}</p>
				{#if connections.ipfsLastLocalDialError}
					<p class="mt-2 text-xs text-red-300">Local Kubo dial error: {connections.ipfsLastLocalDialError}</p>
				{/if}

				<div class="mt-4 space-y-2">
					<h3 class="text-xs font-medium uppercase tracking-wide text-surface-700-300">Helia swarm targets</h3>
					{#if connections.ipfsSwarmAddresses.length > 0}
						<ul class="space-y-2 text-xs break-all">
							{#each connections.ipfsSwarmAddresses as address}
								<li class="rounded-lg border border-surface-200-800 bg-surface-100-900 px-2 py-1">
									<div class="flex items-start justify-between gap-2">
										<span class="font-mono">{address}</span>
										<span class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${connections.ipfsConnectedAddresses.includes(address) ? 'bg-green-500/15 text-green-300' : 'bg-surface-200-800 text-surface-700-300'}`}>
											{connections.ipfsConnectedAddresses.includes(address) ? 'connected' : 'dialing'}
										</span>
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-xs text-surface-700-300">No Helia swarm addresses configured.</p>
					{/if}
				</div>
			</section>
		</aside>

		<section class="space-y-6">
			<header class="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-surface-200-800 p-6">
				<div>
					<p class="text-surface-700-300 text-sm font-medium">On-chain identity</p>
					<h1 class="mt-1 text-2xl font-semibold">Create or edit your profile</h1>
					<p class="text-surface-700-300 mt-2 max-w-2xl text-sm">
						This matches the Acuity profile flow: publish a profile item, store the protobuf payload on IPFS, and update future edits as item revisions.
					</p>
				</div>
				<button class="variant-outline btn" onclick={() => (refreshTick += 1)} disabled={savingProfile}>
					Refresh
				</button>
			</header>

			{#if profileError}
				<div class="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{profileError}</div>
			{:else if profileNotice}
				<div class="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{profileNotice}</div>
			{/if}

			<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-6">
				<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
					<div class="space-y-4">
						<label class="block space-y-2 text-sm">
							<span class="font-medium">Name</span>
							<input class="w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={draft.name} placeholder="Jonathan Brown" disabled={!activeAccount || savingProfile} />
						</label>

						<label class="block space-y-2 text-sm">
							<span class="font-medium">Account type</span>
							<select
								class="w-full rounded-lg border-surface-200-800 bg-surface-100-900"
								value={String(draft.accountType)}
								onchange={(event) => (draft.accountType = Number((event.currentTarget as HTMLSelectElement).value))}
								disabled={!activeAccount || savingProfile}
							>
								{#each accountTypeOptions as option}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</label>

						<label class="block space-y-2 text-sm">
							<span class="font-medium">Location</span>
							<input class="w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={draft.location} placeholder="York, England" disabled={!activeAccount || savingProfile} />
						</label>

						<label class="block space-y-2 text-sm">
							<span class="font-medium">Bio</span>
							<textarea class="min-h-40 w-full rounded-lg border-surface-200-800 bg-surface-100-900" bind:value={draft.bio} placeholder="Describe the person, project, or organization behind this account." disabled={!activeAccount || savingProfile}></textarea>
						</label>

						<label class="block space-y-2 text-sm">
							<span class="font-medium">Avatar image</span>
							<input class="block w-full text-sm" type="file" accept="image/*" onchange={handleImageChange} disabled={!activeAccount || savingProfile} />
							<p class="text-surface-700-300 text-xs">Images are re-encoded to JPEG and uploaded to IPFS as mipmap levels, matching the Dioxus app.</p>
						</label>

						<div class="flex flex-wrap gap-3">
							<button class="btn variant-filled-primary" onclick={submitProfile} disabled={!activeAccount || !connections.api || !connections.heliaNode || savingProfile}>
								{#if savingProfile}
									Saving...
								{:else if profile?.exists}
									Save profile
								{:else}
									Create profile
								{/if}
							</button>
							<button
								class="btn variant-outline"
								onclick={() => {
									if (profile) applyProfile(profile);
								}}
								disabled={!profile || savingProfile}
							>
								Reset
							</button>
						</div>
					</div>

					<div class="space-y-4 rounded-xl border border-surface-200-800 p-4">
						<p class="text-sm font-medium">Preview</p>
						{#if selectedImagePreview ?? profile?.imagePreviewDataUrl}
							<img src={selectedImagePreview ?? profile?.imagePreviewDataUrl ?? ''} alt="Profile avatar" class="mx-auto aspect-square w-40 rounded-full object-cover" />
						{:else}
							<div class="bg-surface-100-900 text-surface-700-300 mx-auto flex aspect-square w-40 items-center justify-center rounded-full text-sm">
								No image
							</div>
						{/if}

						<div class="text-center">
							<h2 class="text-lg font-semibold">{draft.name.trim() || 'Unnamed profile'}</h2>
							<p class="text-surface-700-300 text-sm">{activeAccountTypeLabel}</p>
							{#if draft.location.trim()}
								<p class="mt-2 text-sm">{draft.location}</p>
							{/if}
						</div>
					</div>
				</div>
			</section>
		</section>

		<aside class="space-y-6">
			<section class="border-surface-200-800 bg-surface-50-950 rounded-xl border p-4">
				<h2 class="mb-3 text-base font-medium">Current profile</h2>
				{#if !activeAccount}
					<p class="text-surface-700-300 text-sm">Select an account to view or edit its profile.</p>
				{:else}
					<div class="space-y-3 text-sm">
						{#if loadingProfile}
							<p class="text-surface-700-300 text-xs">Refreshing indexed/IPFS content in the background...</p>
						{/if}
						<div>
							<p class="text-surface-700-300 text-xs uppercase">Account</p>
							<p class="mt-1 font-medium">{formatAccountLabel(activeAccount)}</p>
							<p class="text-surface-700-300 mt-1 break-all text-xs">{activeAccount.address}</p>
						</div>
						<div>
							<p class="text-surface-700-300 text-xs uppercase">Profile item</p>
							<code class="mt-1 block text-xs">{shortHex(profile?.itemIdHex ?? null)}</code>
						</div>
						<div>
							<p class="text-surface-700-300 text-xs uppercase">Latest revision</p>
							<code class="mt-1 block break-all text-xs">{ipfsDigestHexToCid(profile?.revisionIpfsHashHex ?? null)}</code>
						</div>
						<div>
							<p class="text-surface-700-300 text-xs uppercase">State</p>
							<p class="mt-1">
								{#if !profile?.exists}
									Not created yet
								{:else if profile.contentLoaded}
									Published
								{:else}
									Published (content unavailable)
								{/if}
							</p>
						</div>
					</div>
				{/if}
			</section>
		</aside>
	</div>
</main>
