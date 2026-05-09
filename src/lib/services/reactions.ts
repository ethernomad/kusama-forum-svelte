import type { ApiPromise } from '@polkadot/api';
import { encodeAddress } from '@polkadot/util-crypto';

import type { InjectedAccount } from './accounts.svelte';
import { signAndSubmit } from './chain-signing';
import { accountAddressToHex } from './content';
import {
	getIndexedEvents,
	type CustomCompositeKey,
	type DecodedIndexerEvent
} from './indexer.svelte';

export const AVAILABLE_EMOJI_CODEPOINTS = [
	0x1f44d, 0x1f44e, 0x1f60d, 0x1f618, 0x1f61c, 0x1f911, 0x1f92b, 0x1f914, 0x1f910, 0x1f62c, 0x1f925,
	0x1f915, 0x1f922, 0x1f603, 0x1f60e, 0x1f913, 0x1f9d0, 0x1f62d, 0x1f621, 0x1f4af, 0x1f4a4, 0x1f44c,
	0x1f91e, 0x1f44f, 0x1f64f, 0x1f9d9
] as const;

export type ReactionSummary = {
	emojiChar: string;
	codepoint: number;
	count: number;
	reactors: string[];
	iReacted: boolean;
};

function normalizeHex32(value: string): string {
	const hex = value.startsWith('0x') ? value : `0x${value}`;
	if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`Invalid bytes32 hex: ${value}`);
	return hex.toLowerCase();
}

export function itemRevisionIndexerKey(itemIdHex: string, revisionId: number): CustomCompositeKey {
	return {
		type: 'Custom',
		value: {
			name: 'item_id_revision_id',
			kind: 'composite',
			value: [
				{ kind: 'bytes32', value: normalizeHex32(itemIdHex) },
				{ kind: 'u32', value: revisionId }
			]
		}
	};
}

function parseU32(value: unknown): number | null {
	const number =
		typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isInteger(number) && number >= 0 && number <= 0xffffffff ? number : null;
}

function parseReactions(value: unknown): number[] {
	if (Array.isArray(value))
		return value.map(parseU32).filter((entry): entry is number => entry != null);
	const single = parseU32(value);
	return single == null ? [] : [single];
}

function accountHexToSs58(hex: string): string | null {
	try {
		const normalized = normalizeHex32(hex).slice(2);
		const bytes = new Uint8Array(
			normalized.match(/../g)!.map((entry) => Number.parseInt(entry, 16))
		);
		return encodeAddress(bytes);
	} catch {
		return null;
	}
}

function eventOrder(event: DecodedIndexerEvent): [number, number] {
	return [Number(event.blockNumber ?? 0), Number(event.eventIndex ?? 0)];
}

function sortSummaries(summaries: ReactionSummary[]): ReactionSummary[] {
	return summaries.sort(
		(a, b) =>
			AVAILABLE_EMOJI_CODEPOINTS.indexOf(
				a.codepoint as (typeof AVAILABLE_EMOJI_CODEPOINTS)[number]
			) -
			AVAILABLE_EMOJI_CODEPOINTS.indexOf(b.codepoint as (typeof AVAILABLE_EMOJI_CODEPOINTS)[number])
	);
}

export async function fetchReactions(params: {
	itemIdHex: string;
	revisionId: number;
	activeAddress?: string | null;
}): Promise<ReactionSummary[]> {
	const response = await getIndexedEvents<{ events?: DecodedIndexerEvent[] }>({
		key: itemRevisionIndexerKey(params.itemIdHex, params.revisionId),
		limit: 1000
	});

	const latestByReactor = new Map<string, { order: [number, number]; reactions: number[] }>();
	for (const event of response.events ?? []) {
		if (event.event.palletName !== 'ContentReactions' || event.event.eventName !== 'SetReactions')
			continue;
		const fields = event.event.fields;
		const reactorHex = typeof fields.reactor === 'string' ? fields.reactor : null;
		if (!reactorHex) continue;
		const order = eventOrder(event);
		const existing = latestByReactor.get(reactorHex);
		if (
			!existing ||
			order[0] > existing.order[0] ||
			(order[0] === existing.order[0] && order[1] > existing.order[1])
		) {
			latestByReactor.set(reactorHex, { order, reactions: parseReactions(fields.reactions) });
		}
	}

	const activeHex = params.activeAddress ? accountAddressToHex(params.activeAddress) : null;
	const byEmoji = new Map<number, { count: number; reactors: string[]; iReacted: boolean }>();
	for (const [reactorHex, entry] of latestByReactor) {
		const reactorSs58 = accountHexToSs58(reactorHex);
		for (const codepoint of entry.reactions) {
			const summary = byEmoji.get(codepoint) ?? { count: 0, reactors: [], iReacted: false };
			summary.count += 1;
			if (reactorSs58) summary.reactors.push(reactorSs58);
			if (activeHex && normalizeHex32(reactorHex) === activeHex) summary.iReacted = true;
			byEmoji.set(codepoint, summary);
		}
	}

	return sortSummaries(
		Array.from(byEmoji.entries())
			.map(([codepoint, summary]) => ({
				codepoint,
				emojiChar: String.fromCodePoint(codepoint),
				...summary
			}))
			.filter((entry) =>
				AVAILABLE_EMOJI_CODEPOINTS.includes(
					entry.codepoint as (typeof AVAILABLE_EMOJI_CODEPOINTS)[number]
				)
			)
	);
}

export function optimisticReactionUpdate(
	current: ReactionSummary[],
	activeAddress: string,
	newSet: number[]
): ReactionSummary[] {
	const byEmoji = new Map<number, { count: number; reactors: string[]; iReacted: boolean }>();
	for (const reaction of current) {
		const others = reaction.reactors.filter((address) => address !== activeAddress);
		if (!others.length) continue;
		byEmoji.set(reaction.codepoint, { count: others.length, reactors: others, iReacted: false });
	}
	for (const codepoint of newSet) {
		const summary = byEmoji.get(codepoint) ?? { count: 0, reactors: [], iReacted: false };
		summary.count += 1;
		summary.reactors.push(activeAddress);
		summary.iReacted = true;
		byEmoji.set(codepoint, summary);
	}
	return sortSummaries(
		Array.from(byEmoji.entries()).map(([codepoint, summary]) => ({
			codepoint,
			emojiChar: String.fromCodePoint(codepoint),
			...summary
		}))
	);
}

export async function setReactions(params: {
	api: ApiPromise;
	account: InjectedAccount;
	itemIdHex: string;
	revisionId: number;
	reactions: number[];
}): Promise<void> {
	const extrinsic = (
		params.api.tx as Record<
			string,
			Record<string, (...args: unknown[]) => { signAndSend: Function }>
		>
	).contentReactions.setReactions(
		new Uint8Array(
			normalizeHex32(params.itemIdHex)
				.slice(2)
				.match(/../g)!
				.map((entry) => Number.parseInt(entry, 16))
		),
		params.revisionId,
		params.reactions
	);
	const { waitForInBlock } = await signAndSubmit(extrinsic, params.account);
	await waitForInBlock;
}
