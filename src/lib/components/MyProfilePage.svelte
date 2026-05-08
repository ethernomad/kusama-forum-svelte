<script lang="ts">
	import { injectedAccounts } from '$lib/services/accounts.svelte';
	import { connections } from '$lib/services/connections.svelte';
	import {
		loadProfileContent,
		loadProfileMetadata,
		prepareProfileSave,
		saveProfile,
		type LoadedProfile,
		type ProfileDraft
	} from '$lib/services/profile';
	import {
		PUBLISH_NOTICE_AWAITING_SIGNATURE,
		PUBLISH_NOTICE_PREPARING
	} from '$lib/services/publish-notices';


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
	let profileError = $state('');
	let profileNotice = $state('');
	let refreshTick = $state(0);
	let profileLoadRequest = 0;

	const activeAccount = $derived(injectedAccounts.activeAccount);
	const activeAddress = $derived(activeAccount?.address ?? '');
	const activeAccountTypeLabel = $derived(
		accountTypeOptions.find((option) => option.value === draft.accountType)?.label ?? 'Anon'
	);

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
		if (!connections.ipfsHasRequiredLocalConnection) {
			profileError = 'Publishing requires a connection to the local IPFS pinner on one of the default local swarm addresses.';
			return;
		}

		savingProfile = true;
		try {
			profileNotice = PUBLISH_NOTICE_PREPARING;
			const prepared = await prepareProfileSave({
				heliaNode: connections.heliaNode,
				draft,
				existingItemIdHex: profile?.itemIdHex ?? null,
				existingImagePayload,
				selectedImageFile
			});
			profileNotice = PUBLISH_NOTICE_AWAITING_SIGNATURE;
			const saved = await saveProfile({
				api: connections.api,
				heliaNode: connections.heliaNode,
				account: activeAccount,
				draft,
				existingItemIdHex: profile?.itemIdHex ?? null,
				existingImagePayload,
				selectedImageFile,
				prepared
			});
			applyProfile(saved);
			profileNotice = saved.itemIdHex === profile?.itemIdHex ? 'Profile revision published successfully.' : 'Profile created successfully.';
		} catch (error) {
			profileError = error instanceof Error ? error.message : String(error);
		} finally {
			savingProfile = false;
		}
	}
</script>

<div class="space-y-6">
	<section class="space-y-6 min-w-0">
		<header class="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-surface-200-800 p-6">
			<div>
				<p class="text-surface-700-300 text-sm font-medium">On-chain identity</p>
				<h1 class="mt-1 text-2xl font-semibold">Create or edit your profile</h1>
				<p class="text-surface-700-300 mt-2 max-w-2xl text-sm">
					This matches the Acuity profile flow: publish a profile item, store the protobuf payload on IPFS, and update future edits as item revisions.
				</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<a class="btn variant-outline" href="/create-forum">Create forum</a>
				<button class="variant-outline btn" onclick={() => (refreshTick += 1)} disabled={savingProfile}>
					Refresh
				</button>
			</div>
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
						<button class="btn variant-filled-primary" onclick={submitProfile} disabled={!activeAccount || !connections.api || !connections.heliaNode || !connections.ipfsHasRequiredLocalConnection || savingProfile}>
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
</div>
