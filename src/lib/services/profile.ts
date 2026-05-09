import type { ApiPromise } from '@polkadot/api';
import type { Helia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';
import { CID } from 'multiformats/cid';
import { create as createDigest, decode as decodeDigest } from 'multiformats/hashes/digest';
import protobuf from 'protobufjs/minimal';

const { Reader, Writer } = protobuf;
type ProtoReader = InstanceType<typeof Reader>;
type ProtoWriter = InstanceType<typeof Writer>;

function logPublishStep(message: string, details?: Record<string, unknown>): void {
	if (details) {
		console.log(`[publish] ${message}`, details);
		return;
	}
	console.log(`[publish] ${message}`);
}

import type { InjectedAccount } from './accounts.svelte';
import { signAndSubmit, type SignableExtrinsic } from './chain-signing';
import { buildImagePayload, previewDataUrlForImageMixin } from './content-images';
import { getIndexedEvents } from './indexer.svelte';
import { pinPublishedCids, publishBytesToIpfs } from './ipfs-publish';
import { resolvePreparedValue } from './prepared-publish';
const PROFILE_ITEM_FLAGS = 0x01;
const PROFILE_CONTENT_TYPE_ID = 4;
const FORUM_CONTENT_TYPE_ID = 5;
const PROFILE_MIXIN_ID = 0xbeef2144;
const LANGUAGE_MIXIN_ID = 0x9bc7a0e6;
const TITLE_MIXIN_ID = 0x344f4812;
const BODY_TEXT_MIXIN_ID = 0x2d382044;
const IMAGE_MIXIN_ID = 0x045eee8c;
const DEFAULT_LANGUAGE_TAG = 'en';
const ITEM_ID_NAMESPACE = 1000;

type Bytes = Uint8Array<ArrayBufferLike>;

export type ProfileDraft = {
	name: string;
	bio: string;
	location: string;
	accountType: number;
};

export type LoadedProfile = {
	exists: boolean;
	itemIdHex: string | null;
	revisionIpfsHashHex: string | null;
	draft: ProfileDraft;
	imagePreviewDataUrl: string | null;
	existingImagePayload: Bytes | null;
	contentLoaded: boolean;
	contentError: string | null;
};

export type SaveProfileResult = LoadedProfile;

export type PreparedProfileSave = {
	draft: ProfileDraft;
	existingItemIdHex: string | null;
	existingImagePayload: Bytes | null;
	selectedImageFileName: string | null;
	imagePayload: Bytes | null;
	imagePreviewDataUrl: string | null;
	itemPayload: Bytes;
	revisionIpfsHashHex: string;
	revisionIpfsHashBytes: Bytes;
	pinnerCids: string[];
};

type MixinPayload = {
	mixinId: number;
	payload: Bytes;
};

type ItemMessage = {
	contentTypeId: number;
	mixinPayload: MixinPayload[];
};

function u8a(bytes: Uint8Array): Bytes {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy;
}

function createDefaultDraft(): ProfileDraft {
	return {
		name: '',
		bio: '',
		location: '',
		accountType: 0
	};
}

function createEmptyProfile(): LoadedProfile {
	return {
		exists: false,
		itemIdHex: null,
		revisionIpfsHashHex: null,
		draft: createDefaultDraft(),
		imagePreviewDataUrl: null,
		existingImagePayload: null,
		contentLoaded: false,
		contentError: null
	};
}

function equalJsonValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function matchesProfileDraft(left: ProfileDraft, right: ProfileDraft): boolean {
	return equalJsonValue(left, right);
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

function writeUInt64Field(writer: ProtoWriter, fieldNumber: number, value: bigint) {
	writer.uint32((fieldNumber << 3) | 0).uint64(value.toString());
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

function encodeProfileMixin(accountType: number, location: string): Uint8Array {
	const writer = Writer.create();
	writeInt32Field(writer, 1, Number.isInteger(accountType) && accountType >= 0 && accountType <= 8 ? accountType : 0);
	writeStringField(writer, 2, location);
	return writer.finish();
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

function shortHex(value: string | null): string {
	if (!value) return '—';
	return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function ipfsDigestHexToCid(value: string | null): string {
	if (!value) return '—';
	return digestHexToCid(value).toString();
}

export { ipfsDigestHexToCid, shortHex };

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

function cidToDigestHex(cid: CID): string {
	return toHex(cid.multihash.digest);
}

async function addIpfs(heliaNode: Helia, bytes: Uint8Array): Promise<CID> {
	const { cid } = await publishBytesToIpfs(heliaNode, bytes);
	return cid;
}

async function uploadIpfsDigest(heliaNode: Helia, bytes: Uint8Array): Promise<{ digestHex: string; cidText: string }> {
	const cid = await addIpfs(heliaNode, bytes);
	return {
		digestHex: cidToDigestHex(cid),
		cidText: cid.toString()
	};
}

async function fetchIpfsBytesByCid(heliaNode: Helia, cid: CID): Promise<Bytes> {
	const fs = unixfs(heliaNode);
	const chunks: Uint8Array[] = [];
	for await (const chunk of fs.cat(cid)) {
		chunks.push(u8a(chunk));
	}
	return concatBytes(...chunks);
}

async function fetchIpfsDigestBytes(heliaNode: Helia, ipfsHashHex: string): Promise<Bytes> {
	return fetchIpfsBytesByCid(heliaNode, digestHexToCid(ipfsHashHex));
}

function createPublishRevisionExtrinsic(
	api: ApiPromise,
	itemIdBytes: Uint8Array,
	revisionIpfsHashBytes: Uint8Array
): SignableExtrinsic {
	return (
		api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>
	).content.publishRevision(itemIdBytes, [], [], revisionIpfsHashBytes) as SignableExtrinsic;
}

function encodeProfileItem(draft: ProfileDraft, imagePayload: Bytes | null): Bytes {
	const item: ItemMessage = {
		contentTypeId: PROFILE_CONTENT_TYPE_ID,
		mixinPayload: [
			{ mixinId: PROFILE_MIXIN_ID, payload: encodeProfileMixin(draft.accountType, draft.location) },
			{ mixinId: LANGUAGE_MIXIN_ID, payload: encodeLanguageMixin(DEFAULT_LANGUAGE_TAG) },
			{ mixinId: TITLE_MIXIN_ID, payload: encodeTitleMixin(draft.name) },
			{ mixinId: BODY_TEXT_MIXIN_ID, payload: encodeBodyTextMixin(draft.bio) }
		]
	};

	if (imagePayload) {
		item.mixinPayload.push({ mixinId: IMAGE_MIXIN_ID, payload: imagePayload });
	}

	return encodeItemMessage(item);
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

function normalizeItemId(storageValue: unknown): Bytes | null {
	if (!storageValue) return null;
	if (storageValue instanceof Uint8Array) return storageValue.length === 32 ? storageValue : null;
	if (Array.isArray(storageValue)) {
		const bytes = new Uint8Array(storageValue);
		return bytes.length === 32 ? bytes : null;
	}
	if (typeof storageValue === 'string') {
		const bytes = hexToBytes(storageValue);
		return bytes.length === 32 ? bytes : null;
	}
	if (typeof storageValue === 'object' && storageValue !== null) {
		const optionLike = storageValue as {
			isSome?: boolean;
			isNone?: boolean;
			unwrap?: () => unknown;
			toPrimitive?: () => unknown;
			toJSON?: () => unknown;
			toHex?: () => string;
			toU8a?: () => Uint8Array;
			valueOf?: () => unknown;
		};
		if (optionLike.isNone) return null;
		if (optionLike.isSome && optionLike.unwrap) {
			return normalizeItemId(optionLike.unwrap());
		}
		const primitive = optionLike.toPrimitive?.();
		if (primitive != null && primitive !== storageValue) {
			const normalized = normalizeItemId(primitive);
			if (normalized) return normalized;
		}
		const json = optionLike.toJSON?.();
		if (json != null && json !== storageValue) {
			const normalized = normalizeItemId(json);
			if (normalized) return normalized;
		}
		const hex = optionLike.toHex?.();
		if (hex) {
			const bytes = hexToBytes(hex);
			if (bytes.length === 32) return bytes;
		}
		const u8a = optionLike.toU8a?.();
		if (u8a && u8a.length === 32) return u8a;
		const inner = optionLike.valueOf?.();
		if (inner != null && inner !== storageValue) {
			const normalized = normalizeItemId(inner);
			if (normalized) return normalized;
		}
	}
	return null;
}

export async function loadProfileMetadata(api: ApiPromise, address: string): Promise<LoadedProfile> {
	const storageValue = await (api.query as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>).accountProfile.accountProfile(address);
	const itemId = normalizeItemId(storageValue);
	if (!itemId) return createEmptyProfile();

	const itemIdHex = toHex(itemId);
	const revisionIpfsHashHex = await fetchLatestRevisionHash(itemIdHex);
	return {
		exists: true,
		itemIdHex,
		revisionIpfsHashHex,
		draft: createDefaultDraft(),
		imagePreviewDataUrl: null,
		existingImagePayload: null,
		contentLoaded: false,
		contentError: null
	};
}

export async function loadProfileContent(heliaNode: Helia, profile: LoadedProfile): Promise<LoadedProfile> {
	if (!profile.exists || !profile.itemIdHex || !profile.revisionIpfsHashHex) return profile;

	try {
		const itemBytes = await fetchIpfsDigestBytes(heliaNode, profile.revisionIpfsHashHex);
		const item = decodeItemMessage(itemBytes);
		const titlePayload = findMixin(item, TITLE_MIXIN_ID);
		const bodyPayload = findMixin(item, BODY_TEXT_MIXIN_ID);
		const profilePayload = findMixin(item, PROFILE_MIXIN_ID);
		const imagePayload = findMixin(item, IMAGE_MIXIN_ID);
		const contentTypeId = item.contentTypeId;
		if (contentTypeId !== PROFILE_CONTENT_TYPE_ID) {
			throw new Error(`Profile item has unexpected content_type_id ${contentTypeId}; expected ${PROFILE_CONTENT_TYPE_ID}.`);
		}

		const title = titlePayload ? decodeTitleMixin(titlePayload).title : '';
		const bodyText = bodyPayload ? decodeBodyTextMixin(bodyPayload).bodyText : '';
		const decodedProfile = profilePayload ? decodeProfileMixin(profilePayload) : { accountType: 0, location: '' };

		return {
			...profile,
			draft: {
				name: title,
				bio: bodyText,
				location: decodedProfile.location,
				accountType: decodedProfile.accountType
			},
			imagePreviewDataUrl: imagePayload ? await previewDataUrlForImageMixin(heliaNode, imagePayload) : null,
			existingImagePayload: imagePayload,
			contentLoaded: true,
			contentError: null
		};
	} catch (error) {
		return {
			...profile,
			contentLoaded: false,
			contentError: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function loadProfile(api: ApiPromise, heliaNode: Helia, address: string): Promise<LoadedProfile> {
	const metadata = await loadProfileMetadata(api, address);
	return await loadProfileContent(heliaNode, metadata);
}


export async function prepareProfileSave(params: {
	heliaNode: Helia;
	draft: ProfileDraft;
	existingItemIdHex: string | null;
	existingImagePayload: Bytes | null;
	selectedImageFile: File | null;
}): Promise<PreparedProfileSave> {
	const { heliaNode, draft, existingItemIdHex, existingImagePayload, selectedImageFile } = params;
	const builtImage = selectedImageFile ? await buildImagePayload(heliaNode, selectedImageFile) : null;
	const imagePayload = builtImage?.payload ?? existingImagePayload;
	const itemPayload = encodeProfileItem(draft, imagePayload);
	const { digestHex: revisionIpfsHashHex, cidText } = await uploadIpfsDigest(heliaNode, itemPayload);
	return {
		draft: { ...draft },
		existingItemIdHex,
		existingImagePayload,
		selectedImageFileName: selectedImageFile?.name ?? null,
		imagePayload,
		imagePreviewDataUrl: builtImage?.previewDataUrl ?? null,
		itemPayload,
		revisionIpfsHashHex,
		revisionIpfsHashBytes: hexToBytes(revisionIpfsHashHex),
		pinnerCids: [...(builtImage?.cids ?? []), cidText]
	};
}

export async function saveProfile(params: {
	api: ApiPromise;
	heliaNode: Helia;
	account: InjectedAccount;
	draft: ProfileDraft;
	existingItemIdHex: string | null;
	existingImagePayload: Bytes | null;
	selectedImageFile: File | null;
	prepared?: PreparedProfileSave | null;
}): Promise<SaveProfileResult> {
	const { api, heliaNode, account, draft, existingItemIdHex, existingImagePayload, selectedImageFile, prepared } = params;
	logPublishStep('Preparing profile publish', { account: account.address, existingItemIdHex });
	const resolved = await resolvePreparedValue({
		input: { heliaNode, draft, existingItemIdHex, existingImagePayload, selectedImageFile },
		prepared,
		canReusePrepared: (candidate, input) =>
			candidate.existingItemIdHex === input.existingItemIdHex &&
			candidate.selectedImageFileName === (input.selectedImageFile?.name ?? null) &&
			matchesProfileDraft(candidate.draft, input.draft),
		prepare: prepareProfileSave
	});
	const imagePayload = resolved.imagePayload;
	const revisionIpfsHashHex = resolved.revisionIpfsHashHex;
	const revisionIpfsHashBytes = resolved.revisionIpfsHashBytes;

	if (existingItemIdHex) {
		const itemIdBytes = hexToBytes(existingItemIdHex);
		const extrinsic = createPublishRevisionExtrinsic(api, itemIdBytes, revisionIpfsHashBytes);
		logPublishStep('Built profile revision extrinsic', { itemIdHex: existingItemIdHex, cids: resolved.pinnerCids });
		const { waitForInBlock } = await signAndSubmit(extrinsic, account);
		logPublishStep('Profile revision published; starting IPFS propagation', { itemIdHex: existingItemIdHex, cids: resolved.pinnerCids });
		await pinPublishedCids(heliaNode, resolved.pinnerCids);
		logPublishStep('Waiting for profile revision block inclusion', { itemIdHex: existingItemIdHex });
		await waitForInBlock;
		logPublishStep('Updating UI after profile revision block inclusion', { itemIdHex: existingItemIdHex });
		return {
			exists: true,
			itemIdHex: existingItemIdHex,
			revisionIpfsHashHex,
			draft,
			imagePreviewDataUrl: resolved.imagePreviewDataUrl ?? (imagePayload ? await previewDataUrlForImageMixin(heliaNode, imagePayload) : null),
			existingImagePayload: imagePayload,
			contentLoaded: true,
			contentError: null
		};
	}

	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const itemIdBytes = await deriveItemId(account.address, nonce);
	const publishItem = (api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>).content.publishItem(
		nonce,
		[],
		PROFILE_ITEM_FLAGS,
		[],
		[],
		revisionIpfsHashBytes
	);
	const setProfile = (api.tx as Record<string, Record<string, (...args: unknown[]) => unknown>>).accountProfile.setProfile(itemIdBytes);
	const batch = (api.tx as Record<string, Record<string, (...calls: unknown[]) => { signAndSend: Function }>>).utility.batchAll([
		publishItem,
		setProfile
	]);
	logPublishStep('Built profile create extrinsic batch', { itemIdHex: toHex(itemIdBytes), cids: resolved.pinnerCids });
	const { waitForInBlock } = await signAndSubmit(batch as SignableExtrinsic, account);
	logPublishStep('Profile create transaction published; starting IPFS propagation', { itemIdHex: toHex(itemIdBytes), cids: resolved.pinnerCids });
	await pinPublishedCids(heliaNode, resolved.pinnerCids);
	logPublishStep('Waiting for profile create block inclusion', { itemIdHex: toHex(itemIdBytes) });
	await waitForInBlock;
	logPublishStep('Updating UI after profile create block inclusion', { itemIdHex: toHex(itemIdBytes) });

	return {
		exists: true,
		itemIdHex: toHex(itemIdBytes),
		revisionIpfsHashHex,
		draft,
		imagePreviewDataUrl: resolved.imagePreviewDataUrl ?? (imagePayload ? await previewDataUrlForImageMixin(heliaNode, imagePayload) : null),
		existingImagePayload: imagePayload,
		contentLoaded: true,
		contentError: null
	};
}
