import type { ApiPromise } from '@polkadot/api';
import type { Helia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import { create as createDigest, decode as decodeDigest } from 'multiformats/hashes/digest';
import protobuf from 'protobufjs/minimal';
import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';

import type { InjectedAccount } from './accounts.svelte';
import { signAndFinalize, type SignableExtrinsic } from './chain-signing';
import { getIndexedEvents } from './indexer.svelte';
import { publishBytesToIpfs } from './ipfs-publish';
import { resolvePreparedValue } from './prepared-publish';

const { Reader, Writer } = protobuf;
type ProtoReader = InstanceType<typeof Reader>;
type ProtoWriter = InstanceType<typeof Writer>;
type Bytes = Uint8Array<ArrayBufferLike>;

export type MixinPayload = {
	mixinId: number;
	payload: Bytes;
};

type ItemMessage = {
	contentTypeId: number;
	mixinPayload: MixinPayload[];
};

export const REVISIONABLE_ITEM_FLAGS = 0x01;
const PROFILE_ITEM_FLAGS = REVISIONABLE_ITEM_FLAGS;
const PROFILE_CONTENT_TYPE_ID = 4;
const FORUM_CONTENT_TYPE_ID = 5;
const CATEGORY_CONTENT_TYPE_ID = 6;
const FORUM_POST_CONTENT_TYPE_ID = 7;
const COMMENT_CONTENT_TYPE_ID = 8;
const LANGUAGE_MIXIN_ID = 0x9bc7a0e6;
const TITLE_MIXIN_ID = 0x344f4812;
const BODY_TEXT_MIXIN_ID = 0x2d382044;
const IMAGE_MIXIN_ID = 0x045eee8c;
const PROFILE_MIXIN_ID = 0xbeef2144;
const DEFAULT_LANGUAGE_TAG = 'en';
const FORUM_ITEM_FLAGS = 0x00;
const CATEGORY_ITEM_FLAGS = 0x02;
const FORUM_POST_ITEM_FLAGS = REVISIONABLE_ITEM_FLAGS;
const COMMENT_ITEM_FLAGS = REVISIONABLE_ITEM_FLAGS;
const RETRACTED_ITEM_FLAGS = 0x04;
const ITEM_ID_NAMESPACE = 1000;

export type ForumDraft = {
	title: string;
	description: string;
};

export type CategoryDraft = {
	title: string;
	body: string;
};

export type ForumPostDraft = {
	title: string;
	body: string;
};

export type CommentDraft = {
	body: string;
};

export type ContentRevisionDraft = {
	title: string;
	body: string;
};

export type ContentRevisionMeta = {
	revisionId: number;
	ipfsHash: string;
	links: string[];
	mentions: string[];
};

export type ContentItemDebug = {
	itemIdHex: string;
	ownerHex: string | null;
	flags: number | null;
	latestRevisionId: number | null;
	parents: string[];
	revisions: ContentRevisionMeta[];
};

export type DecodedMixinDebug = {
	mixinId: number;
	name: string;
	data: unknown;
	rawHex: string;
};

export type RevisionDebug = ContentRevisionMeta & {
	cid: string;
	contentTypeId: number;
	contentTypeName: string;
	mixins: DecodedMixinDebug[];
};

export type LoadedContent = {
	itemIdHex: string;
	revisionId: number | null;
	revisionIpfsHashHex: string | null;
	latestRevisionId: number | null;
	contentType: 'profile' | 'forum' | 'category' | 'forumPost' | 'comment' | 'unknown';
	contentTypeId: number | null;
	ownerHex: string | null;
	flags: number | null;
	title: string;
	bodyText: string;
	languageTag: string | null;
	profileAccountType: number | null;
	profileLocation: string | null;
	imagePreviewDataUrl: string | null;
	contentLoaded: boolean;
	contentError: string | null;
	rawMixinIds: number[];
	latestLinks: string[];
};

export type PreparedForumSave = {
	draft: ForumDraft;
	itemPayload: Bytes;
	revisionIpfsHashHex: string;
	revisionIpfsHashBytes: Bytes;
};

export type PreparedContentRevision = {
	draft: ContentRevisionDraft;
	contentTypeId: number;
	languageTag: string;
	links: string[];
	revisionIpfsHashHex: string;
	revisionIpfsHashBytes: Bytes;
};

export type ForumCategory = LoadedContent & {
	contentType: 'category';
};

export type ForumPost = LoadedContent & {
	contentType: 'forumPost';
};

export type ForumComment = LoadedContent & {
	contentType: 'comment';
	parentItemIdHex: string;
	publishBlockNumber: number;
	publishEventIndex: number;
	replies: ForumComment[];
};

function u8a(bytes: Uint8Array): Bytes {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy;
}

function writeBytesField(writer: ProtoWriter, fieldNumber: number, value: Bytes) {
	writer.uint32((fieldNumber << 3) | 2).bytes(value);
}

function writeStringField(writer: ProtoWriter, fieldNumber: number, value: string) {
	writer.uint32((fieldNumber << 3) | 2).string(value);
}

function writeUInt32Field(writer: ProtoWriter, fieldNumber: number, value: number) {
	writer.uint32((fieldNumber << 3) | 0).uint32(value >>> 0);
}

function writeInt32Field(writer: ProtoWriter, fieldNumber: number, value: number) {
	writer.uint32((fieldNumber << 3) | 0).int32(value | 0);
}

function encodeMixinPayload(message: MixinPayload): Bytes {
	const writer = Writer.create();
	writer.uint32((1 << 3) | 5).fixed32(message.mixinId >>> 0);
	writeBytesField(writer, 2, message.payload);
	return writer.finish();
}

function decodeMixinPayload(reader: ProtoReader, length: number): MixinPayload {
	const end = reader.pos + length;
	let mixinId = 0;
	let payload: Bytes = new Uint8Array();
	while (reader.pos < end) {
		const tag = reader.uint32();
		switch (tag >>> 3) {
			case 1:
				mixinId = reader.fixed32();
				break;
			case 2:
				payload = u8a(reader.bytes());
				break;
			default:
				reader.skipType(tag & 7);
		}
	}
	return { mixinId, payload };
}

function encodeItemMessage(message: ItemMessage): Uint8Array {
	const writer = Writer.create();
	writeUInt32Field(writer, 1, message.contentTypeId >>> 0);
	for (const mixin of message.mixinPayload) {
		writer.uint32((2 << 3) | 2).bytes(encodeMixinPayload(mixin));
	}
	return writer.finish();
}

function decodeItemMessage(bytes: Uint8Array): ItemMessage {
	const reader = Reader.create(bytes);
	const message: ItemMessage = { contentTypeId: 0, mixinPayload: [] };
	while (reader.pos < reader.len) {
		const tag = reader.uint32();
		switch (tag >>> 3) {
			case 1:
				message.contentTypeId = reader.uint32();
				break;
			case 2:
				message.mixinPayload.push(decodeMixinPayload(reader, reader.uint32()));
				break;
			default:
				reader.skipType(tag & 7);
		}
	}
	return message;
}

function encodeTitleMixin(title: string): Uint8Array {
	const writer = Writer.create();
	writeStringField(writer, 1, title);
	return writer.finish();
}

function decodeTitleMixin(bytes: Uint8Array): { title: string } {
	const reader = Reader.create(bytes);
	let title = '';
	while (reader.pos < reader.len) {
		const tag = reader.uint32();
		if (tag >>> 3 === 1) title = reader.string();
		else reader.skipType(tag & 7);
	}
	return { title };
}

function encodeBodyTextMixin(bodyText: string): Uint8Array {
	const writer = Writer.create();
	writeStringField(writer, 1, bodyText);
	return writer.finish();
}

function decodeBodyTextMixin(bytes: Uint8Array): { bodyText: string } {
	const reader = Reader.create(bytes);
	let bodyText = '';
	while (reader.pos < reader.len) {
		const tag = reader.uint32();
		if (tag >>> 3 === 1) bodyText = reader.string();
		else reader.skipType(tag & 7);
	}
	return { bodyText };
}

function encodeLanguageMixin(languageTag: string): Uint8Array {
	const writer = Writer.create();
	writeStringField(writer, 1, languageTag);
	return writer.finish();
}

function decodeLanguageMixin(bytes: Uint8Array): { languageTag: string } {
	const reader = Reader.create(bytes);
	let languageTag = '';
	while (reader.pos < reader.len) {
		const tag = reader.uint32();
		if (tag >>> 3 === 1) languageTag = reader.string();
		else reader.skipType(tag & 7);
	}
	return { languageTag };
}

function decodeProfileMixin(bytes: Uint8Array): { accountType: number; location: string } {
	const reader = Reader.create(bytes);
	let accountType = 0;
	let location = '';
	while (reader.pos < reader.len) {
		const tag = reader.uint32();
		switch (tag >>> 3) {
			case 1:
				accountType = reader.int32();
				break;
			case 2:
				location = reader.string();
				break;
			default:
				reader.skipType(tag & 7);
		}
	}
	return { accountType, location };
}

function findMixin(item: ItemMessage, mixinId: number): Bytes | null {
	return item.mixinPayload.find((entry) => entry.mixinId === mixinId)?.payload ?? null;
}

function toHex(bytes: Uint8Array): string {
	return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function bytesToHex(bytes: Uint8Array): string {
	return toHex(bytes);
}

export function accountAddressToHex(address: string): string {
	return toHex(decodeAddress(address)).toLowerCase();
}

function accountIdToHex(value: unknown): string | null {
	if (value == null) return null;
	const text = String(value);
	if (/^0x[0-9a-fA-F]{64}$/.test(text)) return text.toLowerCase();
	try {
		return accountAddressToHex(text);
	} catch {
		return null;
	}
}

function hexToBytes(hex: string): Uint8Array {
	const value = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (value.length % 2 !== 0) throw new Error(`Invalid hex: ${hex}`);
	const bytes = new Uint8Array(value.length / 2);
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

export function shortHex(value: string | null): string {
	if (!value) return '—';
	return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const length = parts.reduce((sum, bytes) => sum + bytes.length, 0);
	const out = new Uint8Array(length);
	let offset = 0;
	for (const bytes of parts) {
		out.set(bytes, offset);
		offset += bytes.length;
	}
	return out;
}

function u32Le(value: number): Uint8Array {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value, true);
	return out;
}

async function blake2_256(bytes: Uint8Array): Promise<Bytes> {
	const { blake2AsU8a } = await import('@polkadot/util-crypto');
	return blake2AsU8a(bytes, 256);
}

async function deriveItemId(accountAddress: string, nonce: Uint8Array): Promise<Bytes> {
	await cryptoWaitReady();
	const accountId = decodeAddress(accountAddress);
	return blake2_256(concatBytes(accountId, nonce, u32Le(ITEM_ID_NAMESPACE)));
}

function digestHexToCid(hexValue: string): CID {
	const digest = createDigest(0x12, hexToBytes(hexValue));
	return CID.createV0(digest);
}

export function ipfsDigestHexToCid(value: string | null): string {
	if (!value) return '—';
	return digestHexToCid(value).toString();
}

async function fetchIpfsDigestBytes(heliaNode: Helia, ipfsHashHex: string): Promise<Bytes> {
	const fs = unixfs(heliaNode);
	const chunks: Uint8Array[] = [];
	for await (const chunk of fs.cat(digestHexToCid(ipfsHashHex))) {
		chunks.push(u8a(chunk));
	}
	return concatBytes(...chunks);
}

async function uploadIpfsDigest(heliaNode: Helia, bytes: Uint8Array): Promise<string> {
	const { cid } = await publishBytesToIpfs(heliaNode, bytes);
	return toHex(cid.multihash.digest);
}

function multihashBytesToCid(multihashBytes: Uint8Array): CID {
	const digest = decodeDigest(multihashBytes);
	if (digest.code !== 0x12) {
		throw new Error('Unsupported image multihash algorithm.');
	}
	return CID.createV0(createDigest(0x12, digest.digest));
}

function decodeImageMixin(bytes: Uint8Array): {
	ipfsHash: Bytes;
	mipmapLevel: { ipfsHash: Bytes }[];
} {
	const reader = Reader.create(bytes);
	const message: { ipfsHash: Bytes; mipmapLevel: { ipfsHash: Bytes }[] } = {
		ipfsHash: new Uint8Array(),
		mipmapLevel: []
	};

	while (reader.pos < reader.len) {
		const tag = reader.uint32();
		switch (tag >>> 3) {
			case 3:
				message.ipfsHash = u8a(reader.bytes());
				break;
			case 6: {
				const inner = Reader.create(reader.bytes());
				let ipfsHash: Bytes = new Uint8Array();
				while (inner.pos < inner.len) {
					const innerTag = inner.uint32();
					switch (innerTag >>> 3) {
						case 2:
							ipfsHash = u8a(inner.bytes());
							break;
						default:
							inner.skipType(innerTag & 7);
					}
				}
				message.mipmapLevel.push({ ipfsHash });
				break;
			}
			default:
				reader.skipType(tag & 7);
		}
	}

	return message;
}

async function previewDataUrlForImageMixin(
	heliaNode: Helia,
	payload: Bytes
): Promise<string | null> {
	const image = decodeImageMixin(payload);
	const multihash = image.mipmapLevel[0]?.ipfsHash?.length
		? image.mipmapLevel[0].ipfsHash
		: image.ipfsHash.length
			? image.ipfsHash
			: null;
	if (!multihash) return null;
	const fs = unixfs(heliaNode);
	const chunks: Uint8Array[] = [];
	for await (const chunk of fs.cat(multihashBytesToCid(multihash))) {
		chunks.push(u8a(chunk));
	}
	const bytes = concatBytes(...chunks);
	return `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
}

async function indexerRequest<T>(_method: string, payload: Record<string, unknown>): Promise<T> {
	return await getIndexedEvents<T>(payload);
}

type DecodedEvent = {
	blockNumber?: number;
	eventIndex?: number;
	blockTime?: number | string;
	blockTimestamp?: number | string;
	timestamp?: number | string;
	event: {
		palletName: string;
		eventName: string;
		fields: Record<string, unknown>;
	};
};

async function fetchLatestRevisionHash(itemIdHex: string): Promise<string> {
	const response = await indexerRequest<{ events?: DecodedEvent[] }>('acuity_getEvents', {
		key: {
			type: 'Custom',
			value: {
				name: 'item_id',
				kind: 'bytes32',
				value: itemIdHex
			}
		},
		limit: 100
	});

	const entries = (response.events ?? [])
		.filter((entry) => {
			const eventItemId = normalizeItemId(entry.event.fields.item_id ?? entry.event.fields.itemId);
			return (
				entry.event.palletName === 'Content' &&
				entry.event.eventName === 'PublishRevision' &&
				eventItemId?.toLowerCase() === itemIdHex.toLowerCase()
			);
		})
		.map((entry) => {
			const fields = entry.event.fields;
			return {
				revisionId: Number(fields.revision_id ?? fields.revisionId ?? 0),
				ipfsHash: String(fields.ipfs_hash ?? fields.ipfsHash ?? '')
			};
		})
		.filter((entry) => entry.ipfsHash);

	entries.sort((a, b) => b.revisionId - a.revisionId);
	const latest = entries[0]?.ipfsHash;
	if (!latest)
		throw new Error('No indexed Content::PublishRevision event was found for this item.');
	return latest;
}

function normalizeItemId(value: unknown): string | null {
	if (typeof value === 'string' && value) return value.startsWith('0x') ? value : `0x${value}`;
	if (value instanceof Uint8Array) return toHex(value);
	if (Array.isArray(value)) return toHex(Uint8Array.from(value.map(Number)));
	return null;
}

function extractItemIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		const single = normalizeItemId(value);
		return single ? [single] : [];
	}
	return value.map(normalizeItemId).filter((entry): entry is string => !!entry);
}

function extractAccountIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		const single = accountIdToHex(value);
		return single ? [single] : [];
	}
	return value.map(accountIdToHex).filter((entry): entry is string => !!entry);
}

export async function fetchContentRevisions(itemIdHex: string): Promise<ContentRevisionMeta[]> {
	const response = await indexerRequest<{ events?: DecodedEvent[] }>('acuity_getEvents', {
		key: { type: 'Custom', value: { name: 'item_id', kind: 'bytes32', value: itemIdHex } },
		limit: 100
	});
	const entries = (response.events ?? [])
		.filter((entry) => {
			const eventItemId = normalizeItemId(entry.event.fields.item_id ?? entry.event.fields.itemId);
			return (
				entry.event.palletName === 'Content' &&
				entry.event.eventName === 'PublishRevision' &&
				eventItemId?.toLowerCase() === itemIdHex.toLowerCase()
			);
		})
		.map((entry) => {
			const fields = entry.event.fields;
			return {
				revisionId: Number(fields.revision_id ?? fields.revisionId ?? 0),
				ipfsHash: String(fields.ipfs_hash ?? fields.ipfsHash ?? ''),
				links: extractItemIds(fields.links),
				mentions: extractAccountIds(fields.mentions)
			};
		})
		.filter((entry) => entry.ipfsHash);
	entries.sort((a, b) => b.revisionId - a.revisionId);
	return entries;
}

async function fetchLatestRevisionMeta(itemIdHex: string): Promise<ContentRevisionMeta> {
	const latest = (await fetchContentRevisions(itemIdHex))[0];
	if (!latest)
		throw new Error('No indexed Content::PublishRevision event was found for this item.');
	return latest;
}

function mixinName(mixinId: number): string {
	if (mixinId === LANGUAGE_MIXIN_ID) return 'Language';
	if (mixinId === TITLE_MIXIN_ID) return 'Title';
	if (mixinId === BODY_TEXT_MIXIN_ID) return 'Body text';
	if (mixinId === IMAGE_MIXIN_ID) return 'Image';
	if (mixinId === PROFILE_MIXIN_ID) return 'Profile';
	return 'Unknown mixin';
}

function decodeMixinDebug(mixin: MixinPayload): DecodedMixinDebug {
	let data: unknown;
	try {
		if (mixin.mixinId === LANGUAGE_MIXIN_ID) data = decodeLanguageMixin(mixin.payload);
		else if (mixin.mixinId === TITLE_MIXIN_ID) data = decodeTitleMixin(mixin.payload);
		else if (mixin.mixinId === BODY_TEXT_MIXIN_ID) data = decodeBodyTextMixin(mixin.payload);
		else if (mixin.mixinId === PROFILE_MIXIN_ID) data = decodeProfileMixin(mixin.payload);
		else if (mixin.mixinId === IMAGE_MIXIN_ID) data = decodeImageMixin(mixin.payload);
		else data = { rawHex: toHex(mixin.payload) };
	} catch (error) {
		data = { error: error instanceof Error ? error.message : String(error) };
	}
	return { mixinId: mixin.mixinId, name: mixinName(mixin.mixinId), data, rawHex: toHex(mixin.payload) };
}

export async function loadContentItemDebug(
	heliaNode: Helia,
	itemIdHex: string,
	api: ApiPromise | null = null
): Promise<ContentItemDebug> {
	const normalizedItemIdHex = itemIdHex.startsWith('0x') ? itemIdHex : `0x${itemIdHex}`;
	const [state, revisions, response] = await Promise.all([
		fetchItemState(api, normalizedItemIdHex),
		fetchContentRevisions(normalizedItemIdHex),
		indexerRequest<{ events?: DecodedEvent[] }>('acuity_getEvents', {
			key: { type: 'Custom', value: { name: 'item_id', kind: 'bytes32', value: normalizedItemIdHex } },
			limit: 100
		})
	]);
	const publishItem = (response.events ?? []).find((entry) => {
		const eventItemId = normalizeItemId(entry.event.fields.item_id ?? entry.event.fields.itemId);
		return entry.event.palletName === 'Content' && entry.event.eventName === 'PublishItem' && eventItemId?.toLowerCase() === normalizedItemIdHex.toLowerCase();
	});
	return {
		itemIdHex: normalizedItemIdHex,
		ownerHex: state.ownerHex,
		flags: state.flags,
		latestRevisionId: state.revisionId,
		parents: extractItemIds(publishItem?.event.fields.parents),
		revisions
	};
}

export async function loadRevisionDebug(heliaNode: Helia, revision: ContentRevisionMeta): Promise<RevisionDebug> {
	const itemBytes = await fetchIpfsDigestBytes(heliaNode, revision.ipfsHash);
	const item = decodeItemMessage(itemBytes);
	return {
		...revision,
		cid: ipfsDigestHexToCid(revision.ipfsHash),
		contentTypeId: item.contentTypeId,
		contentTypeName: contentTypeName(item.contentTypeId),
		mixins: item.mixinPayload.map(decodeMixinDebug)
	};
}

export function contentTypeName(contentTypeId: number | null): string {
	if (contentTypeId === PROFILE_CONTENT_TYPE_ID) return 'Profile';
	if (contentTypeId === FORUM_CONTENT_TYPE_ID) return 'Forum';
	if (contentTypeId === CATEGORY_CONTENT_TYPE_ID) return 'Category';
	if (contentTypeId === FORUM_POST_CONTENT_TYPE_ID) return 'Forum post';
	if (contentTypeId === COMMENT_CONTENT_TYPE_ID) return 'Comment';
	return 'Unknown content';
}

function detectContentType(
	contentTypeId: number | null
): 'profile' | 'forum' | 'category' | 'forumPost' | 'comment' | 'unknown' {
	if (contentTypeId === PROFILE_CONTENT_TYPE_ID) return 'profile';
	if (contentTypeId === FORUM_CONTENT_TYPE_ID) return 'forum';
	if (contentTypeId === CATEGORY_CONTENT_TYPE_ID) return 'category';
	if (contentTypeId === FORUM_POST_CONTENT_TYPE_ID) return 'forumPost';
	if (contentTypeId === COMMENT_CONTENT_TYPE_ID) return 'comment';
	return 'unknown';
}

async function fetchItemState(
	api: ApiPromise | null,
	itemIdHex: string
): Promise<{ ownerHex: string | null; flags: number | null; revisionId: number | null }> {
	let ownerHex: string | null = null;
	let flags: number | null = null;
	let revisionId: number | null = null;
	if (api) {
		const itemState = (
			api.query as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
		).content?.itemState;
		if (itemState) {
			const codec = await itemState(hexToBytes(itemIdHex));
			const json = (codec as { toJSON?: () => unknown }).toJSON?.() as
				| Record<string, unknown>
				| null
				| undefined;
			const value = json && typeof json === 'object' && 'owner' in json ? json : null;
			ownerHex = accountIdToHex(value?.owner);
			flags = value?.flags == null ? null : Number(value.flags);
			revisionId = value?.revision_id == null && value?.revisionId == null ? null : Number(value.revision_id ?? value.revisionId);
		}
	}

	if (!ownerHex) {
		const response = await indexerRequest<{ events?: DecodedEvent[] }>('acuity_getEvents', {
			key: { type: 'Custom', value: { name: 'item_id', kind: 'bytes32', value: itemIdHex } },
			limit: 100
		});
		const publishItem = (response.events ?? []).find(
			(entry) => entry.event.palletName === 'Content' && entry.event.eventName === 'PublishItem'
		);
		ownerHex = accountIdToHex(publishItem?.event.fields.owner);
		if (flags == null && publishItem?.event.fields.flags != null)
			flags = Number(publishItem.event.fields.flags);
	}

	return { ownerHex, flags, revisionId };
}

export async function loadContentByItemId(
	heliaNode: Helia,
	itemIdHex: string,
	api: ApiPromise | null = null,
	revisionId: number | null = null
): Promise<LoadedContent> {
	const normalizedItemIdHex = itemIdHex.startsWith('0x') ? itemIdHex : `0x${itemIdHex}`;
	const state = await fetchItemState(api, normalizedItemIdHex);
	const revisions = await fetchContentRevisions(normalizedItemIdHex);
	const selectedRevision =
		revisionId == null ? revisions[0] : revisions.find((entry) => entry.revisionId === revisionId);
	if (!selectedRevision)
		throw new Error('No indexed Content::PublishRevision event was found for this item revision.');
	const revisionIpfsHashHex = selectedRevision.ipfsHash;
	const itemBytes = await fetchIpfsDigestBytes(heliaNode, revisionIpfsHashHex);
	const item = decodeItemMessage(itemBytes);
	const titlePayload = findMixin(item, TITLE_MIXIN_ID);
	const bodyPayload = findMixin(item, BODY_TEXT_MIXIN_ID);
	const languagePayload = findMixin(item, LANGUAGE_MIXIN_ID);
	const profilePayload = findMixin(item, PROFILE_MIXIN_ID);
	const imagePayload = findMixin(item, IMAGE_MIXIN_ID);
	const contentTypeId = item.contentTypeId;
	const decodedProfile = profilePayload ? decodeProfileMixin(profilePayload) : null;

	return {
		itemIdHex: normalizedItemIdHex,
		revisionId: selectedRevision.revisionId,
		revisionIpfsHashHex,
		latestRevisionId: state.revisionId,
		contentType: detectContentType(contentTypeId),
		contentTypeId,
		ownerHex: state.ownerHex,
		flags: state.flags,
		title: titlePayload ? decodeTitleMixin(titlePayload).title : '',
		bodyText: bodyPayload ? decodeBodyTextMixin(bodyPayload).bodyText : '',
		languageTag: languagePayload ? decodeLanguageMixin(languagePayload).languageTag : null,
		profileAccountType: decodedProfile?.accountType ?? null,
		profileLocation: decodedProfile?.location ?? null,
		imagePreviewDataUrl: imagePayload
			? await previewDataUrlForImageMixin(heliaNode, imagePayload)
			: null,
		contentLoaded: true,
		contentError: null,
		rawMixinIds: item.mixinPayload.map((entry) => entry.mixinId),
		latestLinks: selectedRevision.links
	};
}

function encodeContentItem(
	contentTypeId: number,
	title: string | null,
	bodyText: string,
	languageTag = DEFAULT_LANGUAGE_TAG
): Bytes {
	return encodeItemMessage({
		contentTypeId,
		mixinPayload: [
			{ mixinId: LANGUAGE_MIXIN_ID, payload: encodeLanguageMixin(languageTag) },
			...(title == null ? [] : [{ mixinId: TITLE_MIXIN_ID, payload: encodeTitleMixin(title) }]),
			{ mixinId: BODY_TEXT_MIXIN_ID, payload: encodeBodyTextMixin(bodyText) }
		]
	});
}

export function isContentRevisionable(content: Pick<LoadedContent, 'flags'> | null): boolean {
	return content?.flags != null && (content.flags & REVISIONABLE_ITEM_FLAGS) !== 0;
}

export function canEditContent(
	content: Pick<LoadedContent, 'ownerHex' | 'flags'> | null,
	activeAccount: InjectedAccount | null
): boolean {
	return (
		!!content?.ownerHex &&
		!!activeAccount &&
		content.ownerHex === accountAddressToHex(activeAccount.address) &&
		isContentRevisionable(content)
	);
}

function encodeForumItem(draft: ForumDraft): Bytes {
	return encodeContentItem(FORUM_CONTENT_TYPE_ID, draft.title, draft.description);
}

function equalJsonValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function matchesForumDraft(left: ForumDraft, right: ForumDraft): boolean {
	return equalJsonValue(left, right);
}

function matchesContentRevisionDraft(left: ContentRevisionDraft, right: ContentRevisionDraft): boolean {
	return equalJsonValue(left, right);
}

function matchesItemIdList(left: string[], right: string[]): boolean {
	return equalJsonValue(left, right);
}

async function publishItemAndFinalize(params: {
	api: ApiPromise;
	account: InjectedAccount;
	nonce: Uint8Array;
	parents: Uint8Array[];
	links: Uint8Array[];
	flags: number;
	revisionIpfsHashBytes: Uint8Array;
}): Promise<void> {
	const { api, account, nonce, parents, links, flags, revisionIpfsHashBytes } = params;
	const publishItem = (
		api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>
	).content.publishItem(nonce, parents, flags, links, [], revisionIpfsHashBytes);
	await signAndFinalize(publishItem as SignableExtrinsic, account);
}

async function saveEncodedContentItem(params: {
	api: ApiPromise;
	heliaNode: Helia;
	account: InjectedAccount;
	itemPayload: Uint8Array;
	parents: string[];
	links: string[];
	flags: number;
}): Promise<{ itemIdHex: string; revisionIpfsHashHex: string }> {
	const { api, heliaNode, account, itemPayload, parents, links, flags } = params;
	const revisionIpfsHashHex = await uploadIpfsDigest(heliaNode, itemPayload);
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const itemIdBytes = await deriveItemId(account.address, nonce);
	await publishItemAndFinalize({
		api,
		account,
		nonce,
		parents: parents.map(hexToBytes),
		links: links.map(hexToBytes),
		flags,
		revisionIpfsHashBytes: hexToBytes(revisionIpfsHashHex)
	});
	return { itemIdHex: toHex(itemIdBytes), revisionIpfsHashHex };
}

export async function prepareForumSave(params: {
	heliaNode: Helia;
	draft: ForumDraft;
}): Promise<PreparedForumSave> {
	const { heliaNode, draft } = params;
	const itemPayload = encodeForumItem(draft);
	const revisionIpfsHashHex = await uploadIpfsDigest(heliaNode, itemPayload);
	return {
		draft: { ...draft },
		itemPayload,
		revisionIpfsHashHex,
		revisionIpfsHashBytes: hexToBytes(revisionIpfsHashHex)
	};
}

export async function saveForum(params: {
	api: ApiPromise;
	heliaNode: Helia;
	account: InjectedAccount;
	draft: ForumDraft;
	prepared?: PreparedForumSave | null;
}): Promise<{ itemIdHex: string; revisionIpfsHashHex: string }> {
	const { api, heliaNode, account, draft, prepared } = params;
	const resolved = await resolvePreparedValue({
		input: { heliaNode, draft },
		prepared,
		canReusePrepared: (candidate, input) => matchesForumDraft(candidate.draft, input.draft),
		prepare: prepareForumSave
	});
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const itemIdBytes = await deriveItemId(account.address, nonce);
	await publishItemAndFinalize({
		api,
		account,
		nonce,
		parents: [],
		links: [],
		flags: FORUM_ITEM_FLAGS,
		revisionIpfsHashBytes: resolved.revisionIpfsHashBytes
	});
	return {
		itemIdHex: toHex(itemIdBytes),
		revisionIpfsHashHex: resolved.revisionIpfsHashHex
	};
}

export async function saveCategory(params: {
	api: ApiPromise;
	heliaNode: Helia;
	account: InjectedAccount;
	forumItemIdHex: string;
	draft: CategoryDraft;
}): Promise<{ itemIdHex: string; revisionIpfsHashHex: string }> {
	const { api, heliaNode, account, forumItemIdHex, draft } = params;
	return await saveEncodedContentItem({
		api,
		heliaNode,
		account,
		itemPayload: encodeContentItem(CATEGORY_CONTENT_TYPE_ID, draft.title, draft.body),
		parents: [forumItemIdHex],
		links: [],
		flags: CATEGORY_ITEM_FLAGS
	});
}

export async function saveForumPost(params: {
	api: ApiPromise;
	heliaNode: Helia;
	account: InjectedAccount;
	categoryItemIdHex: string;
	draft: ForumPostDraft;
}): Promise<{ itemIdHex: string; revisionIpfsHashHex: string }> {
	const { api, heliaNode, account, categoryItemIdHex, draft } = params;
	return await saveEncodedContentItem({
		api,
		heliaNode,
		account,
		itemPayload: encodeContentItem(FORUM_POST_CONTENT_TYPE_ID, draft.title, draft.body),
		parents: [],
		links: [categoryItemIdHex],
		flags: FORUM_POST_ITEM_FLAGS
	});
}

export async function saveComment(params: {
	api: ApiPromise;
	heliaNode: Helia;
	account: InjectedAccount;
	parentItemIdHex: string;
	draft: CommentDraft;
}): Promise<{ itemIdHex: string; revisionIpfsHashHex: string }> {
	const { api, heliaNode, account, parentItemIdHex, draft } = params;
	return await saveEncodedContentItem({
		api,
		heliaNode,
		account,
		itemPayload: encodeContentItem(COMMENT_CONTENT_TYPE_ID, null, draft.body),
		parents: [parentItemIdHex],
		links: [],
		flags: COMMENT_ITEM_FLAGS
	});
}

export async function prepareContentRevision(params: {
	heliaNode: Helia;
	content: LoadedContent;
	draft: ContentRevisionDraft;
}): Promise<PreparedContentRevision> {
	const { heliaNode, content, draft } = params;
	if (content.contentTypeId == null)
		throw new Error('Cannot revise content with an unknown content type.');
	const languageTag = content.languageTag ?? DEFAULT_LANGUAGE_TAG;
	const revisionIpfsHashHex = await uploadIpfsDigest(
		heliaNode,
		encodeContentItem(content.contentTypeId, draft.title, draft.body, languageTag)
	);
	return {
		draft: { ...draft },
		contentTypeId: content.contentTypeId,
		languageTag,
		links: [...content.latestLinks],
		revisionIpfsHashHex,
		revisionIpfsHashBytes: hexToBytes(revisionIpfsHashHex)
	};
}

export async function publishContentRevision(params: {
	api: ApiPromise;
	heliaNode: Helia;
	account: InjectedAccount;
	content: LoadedContent;
	draft: ContentRevisionDraft;
	prepared?: PreparedContentRevision | null;
}): Promise<{ itemIdHex: string; revisionIpfsHashHex: string }> {
	const { api, heliaNode, account, content, draft, prepared } = params;
	if (!canEditContent(content, account))
		throw new Error('The active account cannot edit this content item.');
	const resolved = await resolvePreparedValue({
		input: { heliaNode, content, draft },
		prepared,
		canReusePrepared: (candidate, input) =>
			candidate.contentTypeId === input.content.contentTypeId &&
			candidate.languageTag === (input.content.languageTag ?? DEFAULT_LANGUAGE_TAG) &&
			matchesItemIdList(candidate.links, input.content.latestLinks) &&
			matchesContentRevisionDraft(candidate.draft, input.draft),
		prepare: prepareContentRevision
	});
	const publishRevision = (
		api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>
	).content.publishRevision(
		hexToBytes(content.itemIdHex),
		content.latestLinks.map(hexToBytes),
		[],
		resolved.revisionIpfsHashBytes
	);
	await signAndFinalize(publishRevision as SignableExtrinsic, account);
	return { itemIdHex: content.itemIdHex, revisionIpfsHashHex: resolved.revisionIpfsHashHex };
}

export async function retractItem(
	api: ApiPromise,
	account: InjectedAccount,
	itemIdHex: string
): Promise<void> {
	const extrinsic = (
		api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>
	).content.retractItem(hexToBytes(itemIdHex));
	await signAndFinalize(extrinsic as SignableExtrinsic, account);
}

function isValidForumCategory(
	entry: LoadedContent | null,
	forum: LoadedContent
): entry is ForumCategory {
	return (
		entry?.contentType === 'category' &&
		entry.ownerHex === forum.ownerHex &&
		(entry.flags == null || (entry.flags & RETRACTED_ITEM_FLAGS) === 0)
	);
}

type PublishedChild = {
	itemIdHex: string;
	parentItemIdHex: string;
	blockNumber: number;
	eventIndex: number;
	blockTime: number;
};

function eventOrderValue(entry: DecodedEvent): number {
	const value = entry.blockTime ?? entry.blockTimestamp ?? entry.timestamp;
	if (typeof value === 'number') return value;
	if (typeof value === 'string') {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) return parsed;
		const numeric = Number(value);
		if (!Number.isNaN(numeric)) return numeric;
	}
	return Number(entry.blockNumber ?? 0);
}

async function loadPublishedChildren(parentItemIdHex: string, limit = 500): Promise<PublishedChild[]> {
	const normalizedParent = parentItemIdHex.toLowerCase();
	const response = await indexerRequest<{ events?: DecodedEvent[] }>('acuity_getEvents', {
		key: { type: 'Custom', value: { name: 'item_id', kind: 'bytes32', value: parentItemIdHex } },
		limit
	});
	const children = new Map<string, PublishedChild>();
	for (const entry of response.events ?? []) {
		if (entry.event.palletName !== 'Content' || entry.event.eventName !== 'PublishItem') continue;
		const itemIdHex = normalizeItemId(entry.event.fields.item_id ?? entry.event.fields.itemId);
		if (!itemIdHex || itemIdHex.toLowerCase() === normalizedParent) continue;
		const parents = extractItemIds(entry.event.fields.parents).map((parent) => parent.toLowerCase());
		if (!parents.includes(normalizedParent)) continue;
		children.set(itemIdHex.toLowerCase(), {
			itemIdHex,
			parentItemIdHex,
			blockNumber: Number(entry.blockNumber ?? 0),
			eventIndex: Number(entry.eventIndex ?? 0),
			blockTime: eventOrderValue(entry)
		});
	}
	return [...children.values()].sort(
		(a, b) => a.blockTime - b.blockTime || a.blockNumber - b.blockNumber || a.eventIndex - b.eventIndex
	);
}

async function loadForumCategoryIds(forum: LoadedContent): Promise<string[]> {
	if (forum.contentType !== 'forum' || !forum.ownerHex) return [];
	return (await loadPublishedChildren(forum.itemIdHex, 200)).map((entry) => entry.itemIdHex);
}

export async function loadForumCategories(params: {
	heliaNode: Helia;
	api: ApiPromise | null;
	forum: LoadedContent;
}): Promise<ForumCategory[]> {
	const { heliaNode, api, forum } = params;
	const categories = await Promise.all(
		(await loadForumCategoryIds(forum)).map((itemId) =>
			loadContentByItemId(heliaNode, itemId, api).catch(() => null)
		)
	);
	return categories.filter((entry): entry is ForumCategory => isValidForumCategory(entry, forum));
}

export async function loadForumCategoriesIncremental(params: {
	heliaNode: Helia;
	api: ApiPromise | null;
	forum: LoadedContent;
	onCategory: (category: ForumCategory) => void;
}): Promise<ForumCategory[]> {
	const { heliaNode, api, forum, onCategory } = params;
	const categories: ForumCategory[] = [];
	await Promise.all(
		(await loadForumCategoryIds(forum)).map(async (itemId) => {
			const entry = await loadContentByItemId(heliaNode, itemId, api).catch(() => null);
			if (!isValidForumCategory(entry, forum)) return;
			categories.push(entry);
			onCategory(entry);
		})
	);
	return categories;
}

function isValidForumPost(
	entry: LoadedContent | null,
	categoryItemIdHex: string
): entry is ForumPost {
	return (
		entry?.contentType === 'forumPost' &&
		(entry.flags == null || (entry.flags & RETRACTED_ITEM_FLAGS) === 0) &&
		entry.latestLinks.map((link) => link.toLowerCase()).includes(categoryItemIdHex.toLowerCase())
	);
}

async function loadCategoryPostIds(category: LoadedContent): Promise<string[]> {
	if (category.contentType !== 'category') return [];
	const response = await indexerRequest<{ events?: DecodedEvent[] }>('acuity_getEvents', {
		key: { type: 'Custom', value: { name: 'item_id', kind: 'bytes32', value: category.itemIdHex } },
		limit: 500
	});
	return [
		...new Set(
			(response.events ?? [])
				.filter(
					(entry) =>
						entry.event.palletName === 'Content' && entry.event.eventName === 'PublishRevision'
				)
				.map((entry) => String(entry.event.fields.item_id ?? entry.event.fields.itemId ?? ''))
				.filter((itemId) => itemId && itemId !== category.itemIdHex)
		)
	];
}

export async function loadCategoryForumPostsIncremental(params: {
	heliaNode: Helia;
	api: ApiPromise | null;
	category: LoadedContent;
	onPost: (post: ForumPost) => void;
}): Promise<ForumPost[]> {
	const { heliaNode, api, category, onPost } = params;
	const posts: ForumPost[] = [];
	await Promise.all(
		(await loadCategoryPostIds(category)).map(async (itemId) => {
			const entry = await loadContentByItemId(heliaNode, itemId, api).catch(() => null);
			if (!isValidForumPost(entry, category.itemIdHex)) return;
			posts.push(entry);
			onPost(entry);
		})
	);
	return posts;
}

function isValidComment(entry: LoadedContent | null): entry is LoadedContent & { contentType: 'comment' } {
	return entry?.contentType === 'comment' && (entry.flags == null || (entry.flags & RETRACTED_ITEM_FLAGS) === 0);
}

export async function loadCommentTree(params: {
	heliaNode: Helia;
	api: ApiPromise | null;
	parentItemIdHex: string;
}): Promise<ForumComment[]> {
	const { heliaNode, api, parentItemIdHex } = params;
	const children = await loadPublishedChildren(parentItemIdHex, 1000);
	const comments = await Promise.all(
		children.map(async (child) => {
			const entry = await loadContentByItemId(heliaNode, child.itemIdHex, api).catch(() => null);
			if (!isValidComment(entry)) return null;
			return {
				...entry,
				parentItemIdHex,
				publishBlockNumber: child.blockNumber,
				publishEventIndex: child.eventIndex,
				replies: await loadCommentTree({ heliaNode, api, parentItemIdHex: child.itemIdHex })
			};
		})
	);
	return comments.filter((entry): entry is ForumComment => !!entry);
}
