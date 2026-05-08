<script lang="ts">
	import { clearAckedCidEntries, ipfsPinningQueue, retryCidAck } from '$lib/services/ipfs-pinning-queue.svelte';

	function formatTimestamp(value: number | null): string {
		return value == null ? '—' : new Date(value).toLocaleString();
	}
</script>

<div class="max-w-5xl space-y-6">
	<header class="rounded-xl border border-dashed border-surface-200-800 p-6">
		<p class="text-sm font-medium text-surface-700-300">Background publishing</p>
		<h1 class="mt-1 text-2xl font-semibold">IPFS pinner status</h1>
		<p class="mt-2 text-sm text-surface-700-300">
			This queue tracks CIDs that have been published locally and still need an acknowledgement from the local pinner.
		</p>
	</header>

	<section class="rounded-xl border border-surface-200-800 bg-surface-50-950 p-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="text-sm text-surface-700-300">
				<span class="font-medium text-white">{ipfsPinningQueue.entries.length}</span> total ·
				<span class="font-medium text-white">{ipfsPinningQueue.entries.filter((entry) => entry.status === 'queued').length}</span> queued ·
				<span class="font-medium text-white">{ipfsPinningQueue.entries.filter((entry) => entry.status === 'sending').length}</span> sending ·
				<span class="font-medium text-white">{ipfsPinningQueue.entries.filter((entry) => entry.status === 'failed').length}</span> failed ·
				<span class="font-medium text-white">{ipfsPinningQueue.entries.filter((entry) => entry.status === 'acked').length}</span> acked
			</div>
			<button class="btn variant-outline" type="button" onclick={() => clearAckedCidEntries()}>
				Clear acked
			</button>
		</div>
	</section>

	<section class="overflow-hidden rounded-xl border border-surface-200-800 bg-surface-50-950">
		{#if ipfsPinningQueue.entries.length === 0}
			<div class="p-6 text-sm text-surface-700-300">No CIDs are waiting for the pinner.</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full text-left text-sm">
					<thead class="bg-surface-100-900 text-surface-700-300">
						<tr>
							<th class="px-4 py-3 font-medium">CID</th>
							<th class="px-4 py-3 font-medium">Status</th>
							<th class="px-4 py-3 font-medium">Attempts</th>
							<th class="px-4 py-3 font-medium">Created</th>
							<th class="px-4 py-3 font-medium">Updated</th>
							<th class="px-4 py-3 font-medium">Acked</th>
							<th class="px-4 py-3 font-medium">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each ipfsPinningQueue.entries as entry (entry.cid)}
							<tr class="border-t border-surface-200-800 align-top">
								<td class="max-w-xl px-4 py-3 font-mono text-xs break-all">{entry.cid}</td>
								<td class="px-4 py-3">
									<span class={`rounded px-2 py-1 text-xs ${entry.status === 'acked' ? 'bg-green-500/15 text-green-300' : entry.status === 'failed' ? 'bg-red-500/15 text-red-300' : entry.status === 'sending' ? 'bg-amber-500/15 text-amber-200' : 'bg-surface-200-800 text-surface-700-300'}`}>
										{entry.status}
									</span>
									{#if entry.lastError}
										<p class="mt-2 max-w-xs text-xs text-red-300">{entry.lastError}</p>
									{/if}
								</td>
								<td class="px-4 py-3">{entry.attempts}</td>
								<td class="px-4 py-3 text-xs text-surface-700-300">{formatTimestamp(entry.createdAt)}</td>
								<td class="px-4 py-3 text-xs text-surface-700-300">{formatTimestamp(entry.updatedAt)}</td>
								<td class="px-4 py-3 text-xs text-surface-700-300">{formatTimestamp(entry.ackedAt)}</td>
								<td class="px-4 py-3">
									{#if entry.status === 'failed'}
										<button class="btn variant-outline" type="button" onclick={() => retryCidAck(entry.cid)}>Retry</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
