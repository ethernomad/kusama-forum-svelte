import { CID } from 'multiformats/cid';
import { base64 } from 'multiformats/bases/base64';
import { create as createDigest, decode as decodeDigest } from 'multiformats/hashes/digest';

type IpfsIdResponse = {
	ID: string;
	PublicKey?: string;
	Addresses?: string[];
	AgentVersion?: string;
	ProtocolVersion?: string;
	Protocols?: string[];
};

type IpfsAddResponse = {
	Hash: string;
};

export type IpfsDaemonInfo = {
	peerId: string;
	publicKey: string | null;
	addresses: string[];
	agentVersion: string | null;
	protocolVersion: string | null;
	protocols: string[];
};

const DEFAULT_IPFS_API_URL = 'http://127.0.0.1:5001';
const DAG_PB_CODEC = 0x70;

export function ipfsApiUrl(): string {
	return import.meta.env.VITE_IPFS_API_URL?.trim() || DEFAULT_IPFS_API_URL;
}

export function digestHexToCid(hexValue: string): CID {
	const digest = createDigest(0x12, hexToBytes(hexValue));
	return CID.createV0(digest);
}

export function cidToDigestHex(cid: CID | string): string {
	const parsed = typeof cid === 'string' ? CID.parse(cid) : cid;
	return toHex(parsed.multihash.digest);
}

export function digestHexToBase64Cid(hexValue: string): string {
	return CID.createV1(DAG_PB_CODEC, createDigest(0x12, hexToBytes(hexValue))).toString(base64);
}

export function multihashBytesToBase64Cid(multihashBytes: Uint8Array): string {
	return CID.createV1(DAG_PB_CODEC, decodeDigest(multihashBytes)).toString(base64);
}

export async function ipfsDaemonId(): Promise<IpfsDaemonInfo> {
	const response = await fetch(`${ipfsApiUrl()}/api/v0/id`, {
		method: 'POST'
	});
	if (!response.ok) {
		throw new Error(
			`IPFS daemon returned ${response.status} ${response.statusText} for /api/v0/id`
		);
	}
	const payload = (await response.json()) as IpfsIdResponse;
	if (!payload.ID) {
		throw new Error('IPFS daemon returned an empty peer ID.');
	}
	return {
		peerId: payload.ID,
		publicKey: payload.PublicKey ?? null,
		addresses: payload.Addresses ?? [],
		agentVersion: payload.AgentVersion ?? null,
		protocolVersion: payload.ProtocolVersion ?? null,
		protocols: payload.Protocols ?? []
	};
}

export async function uploadRawIpfsCid(
	bytes: Uint8Array,
	fileName = 'content.bin'
): Promise<string> {
	const form = new FormData();
	form.append('file', new Blob([bytes.slice().buffer]), fileName);
	const response = await fetch(`${ipfsApiUrl()}/api/v0/add?pin=true&quieter=true`, {
		method: 'POST',
		body: form
	});
	if (!response.ok) {
		throw new Error(
			`IPFS daemon returned ${response.status} ${response.statusText} for /api/v0/add`
		);
	}
	const text = await response.text();
	const lastLine = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (!lastLine) {
		throw new Error('IPFS add returned an empty response.');
	}
	const payload = JSON.parse(lastLine) as IpfsAddResponse;
	if (!payload.Hash) {
		throw new Error('IPFS add response did not include a CID.');
	}
	return payload.Hash;
}

export async function uploadIpfsDigest(
	bytes: Uint8Array,
	fileName = 'content.bin'
): Promise<string> {
	return cidToDigestHex(await uploadRawIpfsCid(bytes, fileName));
}

export async function fetchIpfsBytesByCid(cid: CID | string): Promise<Uint8Array> {
	const arg = typeof cid === 'string' ? cid : cid.toString();
	const response = await fetch(`${ipfsApiUrl()}/api/v0/cat?arg=${encodeURIComponent(arg)}`, {
		method: 'POST'
	});
	if (!response.ok) {
		throw new Error(
			`IPFS daemon returned ${response.status} ${response.statusText} for /api/v0/cat`
		);
	}
	return new Uint8Array(await response.arrayBuffer());
}

export async function fetchIpfsDigestBytes(ipfsHashHex: string): Promise<Uint8Array> {
	return await fetchIpfsBytesByCid(digestHexToCid(ipfsHashHex));
}

function hexToBytes(value: string): Uint8Array {
	const normalized = value.startsWith('0x') ? value.slice(2) : value;
	if (normalized.length % 2 !== 0) throw new Error(`Invalid hex byte length for ${value}`);
	const out = new Uint8Array(normalized.length / 2);
	for (let index = 0; index < out.length; index += 1) {
		out[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
	}
	return out;
}

function toHex(bytes: Uint8Array): string {
	return `0x${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
