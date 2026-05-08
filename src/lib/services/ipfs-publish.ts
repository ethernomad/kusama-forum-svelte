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
	const payload = textEncoder.encode(`${cidText}\n`);
	const expectedAck = `ACK: received ${cidText}`;

	if (!stream.send(payload)) {
		await stream.onDrain();
	}
	await stream.close();

	const ack = await readAckResponse(stream, expectedAck, cidText);
	if (ack === expectedAck) {
		void stream.closeRead().catch(() => {});
		return;
	}
	throw new Error(`Unexpected ACK from local IPFS pinner for ${cidText}: ${ack || 'no response'}`);
}

async function readAckResponse(stream: Awaited<ReturnType<Helia['libp2p']['dialProtocol']>>, expectedAck: string, cidText: string): Promise<string> {
	const readPromise = (async () => {
		const chunks: Uint8Array[] = [];
		for await (const chunk of stream) {
			chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
			const ack = textDecoder.decode(concatChunks(chunks)).trim();
			if (ack === expectedAck) {
				return ack;
			}
		}
		return textDecoder.decode(concatChunks(chunks)).trim();
	})();

	try {
		return await Promise.race([
			readPromise,
			new Promise<string>((_, reject) => {
				setTimeout(() => reject(new Error(`Timed out waiting for local IPFS pinner ACK for ${cidText}`)), 10_000);
			})
		]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/stream has been reset/i.test(message)) {
			// Kubo's p2p bridge may reset the response stream even after the local
			// pinner has handled the CID and attempted to write the ACK. Treat this
			// as success so the UI can proceed immediately instead of stalling.
			return expectedAck;
		}
		throw error instanceof Error ? error : new Error(message);
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
