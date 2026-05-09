import type { Helia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import { create as createDigest, decode as decodeDigest } from 'multiformats/hashes/digest';
import protobuf from 'protobufjs/minimal';

import { publishBytesToIpfs } from './ipfs-publish';

const { Reader, Writer } = protobuf;
type Bytes = Uint8Array<ArrayBufferLike>;
type ProtoWriter = InstanceType<typeof Writer>;

const JPEG_QUALITY = 0.82;

export type DecodedImageMixin = {
	ipfsHash: Bytes;
	mipmapLevel: { ipfsHash: Bytes }[];
};

type ImageMixinMessage = {
	filename: string;
	filesize: bigint;
	ipfsHash: Bytes;
	width: number;
	height: number;
	mipmapLevel: { filesize: bigint; ipfsHash: Bytes }[];
};

function u8a(bytes: Uint8Array): Bytes {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy;
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

function writeBytesField(writer: ProtoWriter, fieldNumber: number, value: Bytes) {
	writer.uint32((fieldNumber << 3) | 2).bytes(value);
}

function writeStringField(writer: ProtoWriter, fieldNumber: number, value: string) {
	writer.uint32((fieldNumber << 3) | 2).string(value);
}

function writeUInt32Field(writer: ProtoWriter, fieldNumber: number, value: number) {
	writer.uint32((fieldNumber << 3) | 0).uint32(value >>> 0);
}

function writeUInt64Field(writer: ProtoWriter, fieldNumber: number, value: bigint) {
	writer.uint32((fieldNumber << 3) | 0).uint64(value.toString());
}

function encodeMipmapLevelMessage(message: { filesize: bigint; ipfsHash: Bytes }): Bytes {
	const writer = Writer.create();
	writeUInt64Field(writer, 1, message.filesize);
	writeBytesField(writer, 2, message.ipfsHash);
	return writer.finish();
}

function encodeImageMixin(message: ImageMixinMessage): Uint8Array {
	const writer = Writer.create();
	writeStringField(writer, 1, message.filename);
	writeUInt64Field(writer, 2, message.filesize);
	writeBytesField(writer, 3, message.ipfsHash);
	writeUInt32Field(writer, 4, message.width);
	writeUInt32Field(writer, 5, message.height);
	for (const level of message.mipmapLevel) {
		writer.uint32((6 << 3) | 2).bytes(encodeMipmapLevelMessage(level));
	}
	return writer.finish();
}

function multihashBytesToCid(multihashBytes: Uint8Array): CID {
	const digest = decodeDigest(multihashBytes);
	if (digest.code !== 0x12) {
		throw new Error('Unsupported image multihash algorithm.');
	}
	return CID.createV0(createDigest(0x12, digest.digest));
}

async function addIpfs(heliaNode: Helia, bytes: Uint8Array): Promise<CID> {
	const { cid } = await publishBytesToIpfs(heliaNode, bytes);
	return cid;
}

async function fetchIpfsBytesByCid(heliaNode: Helia, cid: CID): Promise<Bytes> {
	const fs = unixfs(heliaNode);
	const chunks: Uint8Array[] = [];
	for await (const chunk of fs.cat(cid)) {
		chunks.push(u8a(chunk));
	}
	return concatBytes(...chunks);
}

async function openImageBitmapFromFile(file: File): Promise<ImageBitmap> {
	return createImageBitmap(file);
}

async function renderJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Bytes> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context is unavailable.');
	ctx.drawImage(bitmap, 0, 0, width, height);
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((value) => {
			if (value) resolve(value);
			else reject(new Error('Failed to encode JPEG preview.'));
		}, 'image/jpeg', JPEG_QUALITY);
	});
	return new Uint8Array(await blob.arrayBuffer());
}

export function decodeImageMixin(bytes: Uint8Array): DecodedImageMixin {
	const reader = Reader.create(bytes);
	const message: DecodedImageMixin = {
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

export async function buildImagePayload(
	heliaNode: Helia,
	file: File
): Promise<{ payload: Bytes; previewDataUrl: string }> {
	const bitmap = await openImageBitmapFromFile(file);
	try {
		const width = bitmap.width;
		const height = bitmap.height;
		const mipmapLevel: { filesize: bigint; ipfsHash: Bytes }[] = [];
		let previewDataUrl = '';
		let level = 0;

		while (true) {
			const scale = 2 ** level;
			const outWidth = Math.max(1, Math.round(width / scale));
			const outHeight = Math.max(1, Math.round(height / scale));
			const jpegBytes = await renderJpeg(bitmap, outWidth, outHeight);
			if (!previewDataUrl) {
				previewDataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpegBytes))}`;
			}
			const cid = await addIpfs(heliaNode, jpegBytes);
			mipmapLevel.push({
				filesize: BigInt(jpegBytes.length),
				ipfsHash: u8a(cid.multihash.bytes)
			});

			if (outWidth <= 64 || outHeight <= 64) break;
			level += 1;
		}

		return {
			payload: encodeImageMixin({
				filename: '',
				filesize: 0n,
				ipfsHash: new Uint8Array(),
				width,
				height,
				mipmapLevel
			}),
			previewDataUrl
		};
	} finally {
		bitmap.close();
	}
}

export async function previewDataUrlForImageMixin(
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
	const bytes = await fetchIpfsBytesByCid(heliaNode, multihashBytesToCid(multihash));
	return `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
}
