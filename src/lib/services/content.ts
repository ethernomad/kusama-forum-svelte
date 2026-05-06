import type { ApiPromise } from '@polkadot/api';
import type { Helia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import { create as createDigest, decode as decodeDigest } from 'multiformats/hashes/digest';
import protobuf from 'protobufjs/minimal';
import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';

import type { InjectedAccount } from './accounts.svelte';
import { getIndexedEvents } from './indexer.svelte';
import { beginIpfsProvide, completeIpfsProvide, failIpfsProvide } from './ipfs-provide-status.svelte';

const { Reader, Writer } = protobuf;
type ProtoReader = InstanceType<typeof Reader>;
type ProtoWriter = InstanceType<typeof Writer>;
type Bytes = Uint8Array<ArrayBufferLike>;

type MixinPayload = {
	mixinId: number;
	payload: Bytes;
};

type ItemMessage = {
	mixinPayload: MixinPayload[];
};

const PROFILE_ITEM_FLAGS = 0x01;
const LANGUAGE_MIXIN_ID = 0x9bc7a0e6;
const TITLE_MIXIN_ID = 0x344f4812;
const BODY_TEXT_MIXIN_ID = 0x2d382044;
const IMAGE_MIXIN_ID = 0x045eee8c;
const PROFILE_MIXIN_ID = 0xbeef2144;
const DEFAULT_LANGUAGE_TAG = 'en';
const FORUM_ITEM_FLAGS = 0x00;
const ITEM_ID_NAMESPACE = 1000;

export type ForumDraft = {
	title: string;
	description: string;
};

export type LoadedContent = {
	itemIdHex: string;
	revisionIpfsHashHex: string | null;
	contentType: 'profile' | 'forum' | 'unknown';
	title: string;
	bodyText: string;
	languageTag: string | null;
	profileAccountType: number | null;
	profileLocation: string | null;
	imagePreviewDataUrl: string | null;
	contentLoaded: boolean;
	contentError: string | null;
	rawMixinIds: number[];
};

export type PreparedForumSave = {
	draft: ForumDraft;
	itemPayload: Bytes;
	revisionIpfsHashHex: string;
	revisionIpfsHashBytes: Bytes;
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
	for (const mixin of message.mixinPayload) {
		writer.uint32((1 << 3) | 2).bytes(encodeMixinPayload(mixin));
	}
	return writer.finish();
}

function decodeItemMessage(bytes: Uint8Array): ItemMessage {
	const reader = Reader.create(bytes);
	const message: ItemMessage = { mixinPayload: [] };
	while (reader.pos < reader.len) {
		const tag = reader.uint32();
		switch (tag >>> 3) {
			case 1:
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
		if ((tag >>> 3) === 1) title = reader.string();
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
		if ((tag >>> 3) === 1) bodyText = reader.string();
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
		if ((tag >>> 3) === 1) languageTag = reader.string();
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

function provideCidInBackground(heliaNode: Helia, cid: CID): void {
	const cidText = cid.toString();
	beginIpfsProvide(cidText);
	void heliaNode.routing
		.provide(cid)
		.then(() => {
			completeIpfsProvide(cidText);
		})
		.catch((error) => {
			failIpfsProvide(cidText, error);
			console.error('Background IPFS provide failed for CID', cidText, error);
		});
}

async function addIpfs(heliaNode: Helia, bytes: Uint8Array): Promise<CID> {
	const fs = unixfs(heliaNode);
	const cid = await fs.addBytes(bytes, {
		cidVersion: 0,
		rawLeaves: false
	});
	provideCidInBackground(heliaNode, cid);
	return cid;
}

async function uploadIpfsDigest(heliaNode: Helia, bytes: Uint8Array): Promise<string> {
	const cid = await addIpfs(heliaNode, bytes);
	return toHex(cid.multihash.digest);
}

function multihashBytesToCid(multihashBytes: Uint8Array): CID {
	const digest = decodeDigest(multihashBytes);
	if (digest.code !== 0x12) {
		throw new Error('Unsupported image multihash algorithm.');
	}
	return CID.createV0(createDigest(0x12, digest.digest));
}

function decodeImageMixin(bytes: Uint8Array): { ipfsHash: Bytes; mipmapLevel: { ipfsHash: Bytes }[] } {
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

async function previewDataUrlForImageMixin(heliaNode: Helia, payload: Bytes): Promise<string | null> {
	const image = decodeImageMixin(payload);
	const multihash = image.mipmapLevel[0]?.ipfsHash?.length ? image.mipmapLevel[0].ipfsHash : image.ipfsHash.length ? image.ipfsHash : null;
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
	event: {
		palletName: string;
		eventName: string;
		fields: Record<string, unknown>;
	};
};

async function fetchLatestRevisionHash(itemIdHex: string): Promise<string> {
	const response = await indexerRequest<{ decodedEvents?: DecodedEvent[] }>('acuity_getEvents', {
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

	const entries = (response.decodedEvents ?? [])
		.filter((entry) => entry.event.palletName === 'Content' && entry.event.eventName === 'PublishRevision')
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
	if (!latest) throw new Error('No indexed Content::PublishRevision event was found for this item.');
	return latest;
}

function detectContentType(item: ItemMessage): 'profile' | 'forum' | 'unknown' {
	if (findMixin(item, PROFILE_MIXIN_ID)) return 'profile';
	if (findMixin(item, TITLE_MIXIN_ID) || findMixin(item, BODY_TEXT_MIXIN_ID)) return 'forum';
	return 'unknown';
}

export async function loadContentById(heliaNode: Helia, itemIdHex: string): Promise<LoadedContent> {
	const normalizedItemIdHex = itemIdHex.startsWith('0x') ? itemIdHex : `0x${itemIdHex}`;
	const revisionIpfsHashHex = await fetchLatestRevisionHash(normalizedItemIdHex);
	const itemBytes = await fetchIpfsDigestBytes(heliaNode, revisionIpfsHashHex);
	const item = decodeItemMessage(itemBytes);
	const titlePayload = findMixin(item, TITLE_MIXIN_ID);
	const bodyPayload = findMixin(item, BODY_TEXT_MIXIN_ID);
	const languagePayload = findMixin(item, LANGUAGE_MIXIN_ID);
	const profilePayload = findMixin(item, PROFILE_MIXIN_ID);
	const imagePayload = findMixin(item, IMAGE_MIXIN_ID);
	const decodedProfile = profilePayload ? decodeProfileMixin(profilePayload) : null;

	return {
		itemIdHex: normalizedItemIdHex,
		revisionIpfsHashHex,
		contentType: detectContentType(item),
		title: titlePayload ? decodeTitleMixin(titlePayload).title : '',
		bodyText: bodyPayload ? decodeBodyTextMixin(bodyPayload).bodyText : '',
		languageTag: languagePayload ? decodeLanguageMixin(languagePayload).languageTag : null,
		profileAccountType: decodedProfile?.accountType ?? null,
		profileLocation: decodedProfile?.location ?? null,
		imagePreviewDataUrl: imagePayload ? await previewDataUrlForImageMixin(heliaNode, imagePayload) : null,
		contentLoaded: true,
		contentError: null,
		rawMixinIds: item.mixinPayload.map((entry) => entry.mixinId)
	};
}

function encodeForumItem(draft: ForumDraft): Bytes {
	return encodeItemMessage({
		mixinPayload: [
			{ mixinId: LANGUAGE_MIXIN_ID, payload: encodeLanguageMixin(DEFAULT_LANGUAGE_TAG) },
			{ mixinId: TITLE_MIXIN_ID, payload: encodeTitleMixin(draft.title) },
			{ mixinId: BODY_TEXT_MIXIN_ID, payload: encodeBodyTextMixin(draft.description) }
		]
	});
}

async function signAndFinalize(extrinsic: { signAndSend: Function }, account: InjectedAccount): Promise<void> {
	if (typeof window === 'undefined') {
		throw new Error('Signing is only available in the browser.');
	}
	const { web3FromSource } = await import('@polkadot/extension-dapp');
	const injector = await web3FromSource(String(account.meta.source ?? ''));
	await new Promise<void>((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		void extrinsic
			.signAndSend(account.address, { signer: injector.signer }, (result: { status: { isFinalized?: boolean }; dispatchError?: unknown }) => {
				if (result.dispatchError) {
					unsubscribe?.();
					reject(new Error('Transaction failed on chain.'));
					return;
				}
				if (result.status?.isFinalized) {
					unsubscribe?.();
					resolve();
				}
			})
			.then((unsub: () => void) => {
				unsubscribe = unsub;
			})
			.catch(reject);
	});
}

export async function prepareForumSave(params: { heliaNode: Helia; draft: ForumDraft }): Promise<PreparedForumSave> {
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
	const canReusePrepared = prepared != null && JSON.stringify(prepared.draft) === JSON.stringify(draft);
	const resolved = canReusePrepared ? prepared : await prepareForumSave({ heliaNode, draft });
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const itemIdBytes = await deriveItemId(account.address, nonce);
	const publishItem = (api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>).content.publishItem(
		nonce,
		[],
		FORUM_ITEM_FLAGS,
		[],
		[],
		resolved.revisionIpfsHashBytes
	);
	await signAndFinalize(publishItem as { signAndSend: Function }, account);
	return {
		itemIdHex: toHex(itemIdBytes),
		revisionIpfsHashHex: resolved.revisionIpfsHashHex
	};
}
