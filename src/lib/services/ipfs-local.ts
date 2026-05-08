import type { Helia } from 'helia';

export const DEFAULT_LOCAL_IPFS_MULTIADDRS = [
	'/ip4/127.0.0.1/tcp/4002/ws/p2p/12D3KooWPp5C2RJQvTKRfTiwSgKxme9HcUY9zUt354RGpgb5zMBq',
	'/ip6/::1/tcp/4002/ws/p2p/12D3KooWPp5C2RJQvTKRfTiwSgKxme9HcUY9zUt354RGpgb5zMBq'
] as const;

export function extractPeerIdFromMultiaddr(address: string): string {
	return address.split('/p2p/')[1] ?? '';
}

export function hasDefaultLocalIpfsConnection(heliaNode: Helia | null | undefined): boolean {
	if (!heliaNode) return false;
	const localPeerIds = DEFAULT_LOCAL_IPFS_MULTIADDRS.map(extractPeerIdFromMultiaddr).filter(Boolean);
	return heliaNode.libp2p
		.getConnections()
		.some((connection) => localPeerIds.includes(connection.remotePeer?.toString() ?? ''));
}

export function defaultLocalIpfsConnectionAddress(heliaNode: Helia): string | null {
	const connectedPeerIds = new Set(
		helianodeConnectionPeerIds(heliaNode)
	);
	return (
		DEFAULT_LOCAL_IPFS_MULTIADDRS.find((address) => connectedPeerIds.has(extractPeerIdFromMultiaddr(address))) ?? null
	);
}

function helianodeConnectionPeerIds(heliaNode: Helia): string[] {
	return heliaNode.libp2p
		.getConnections()
		.map((connection) => connection.remotePeer?.toString() ?? '')
		.filter(Boolean);
}
