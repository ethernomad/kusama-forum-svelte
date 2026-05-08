import { unixfs } from '@helia/unixfs';
import { multiaddr } from '@multiformats/multiaddr';
import type { Helia } from 'helia';
import type { CID } from 'multiformats/cid';

import {
	beginIpfsProvide,
	completeIpfsProvide,
	failIpfsProvide
} from './ipfs-provide-status.svelte';
import {
	defaultLocalIpfsConnectionAddress,
	hasDefaultLocalIpfsConnection
} from './ipfs-local';

const ACK_PROTOCOL = '/x/acuity/ack/1.0.0';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type PublishResult = {
	cid: CID;
};

export function assertDefaultLocalIpfsConnection(heliaNode: Helia): void {
	if (!hasDefaultLocalIpfsConnection(heliaNode)) {
		throw new Error('Publishing requires a connection to the local IPFS pinner. Connect to one of the default local IPFS swarm addresses and try again.');
	}
}

export async function publishBytesToIpfsWithAck(
	heliaNode: Helia,
	bytes: Uint8Array
): Promise<PublishResult> {
	assertDefaultLocalIpfsConnection(heliaNode);
	const fs = unixfs(heliaNode);
	const cid = await fs.addBytes(bytes, {
		cidVersion: 0,
		rawLeaves: false
	});
	await provideAndAckCid(heliaNode, cid);
	return { cid };
}

export async function provideAndAckCid(heliaNode: Helia, cid: CID): Promise<void> {
	assertDefaultLocalIpfsConnection(heliaNode);
	const cidText = cid.toString();
	beginIpfsProvide(cidText);
	try {
		await heliaNode.routing.provide(cid);
		await pushCidAck(heliaNode, cidText);
		completeIpfsProvide(cidText);
	} catch (error) {
		failIpfsProvide(cidText, error);
		throw error;
	}
}

async function pushCidAck(heliaNode: Helia, cidText: string): Promise<void> {
	const target = defaultLocalIpfsConnectionAddress(heliaNode);
	if (!target) {
		throw new Error('Publishing requires an active connection to the local IPFS pinner.');
	}

	const stream = await heliaNode.libp2p.dialProtocol(multiaddr(target), ACK_PROTOCOL);
	stream.send(textEncoder.encode(cidText));
	await stream.close();

	const chunks: Uint8Array[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
	}

	const ack = textDecoder.decode(concatChunks(chunks)).trim();
	const expectedAck = `ACK: received ${cidText}`;
	if (ack !== expectedAck) {
		throw new Error(`Unexpected ACK from local IPFS pinner for ${cidText}: ${ack || 'no response'}`);
	}
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
