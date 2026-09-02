export function updatePeerIceServers(peer, iceServers) {
  if (typeof peer?.setConfiguration !== "function") return false;
  const current =
    typeof peer.getConfiguration === "function"
      ? peer.getConfiguration()
      : peer.configuration || {};
  peer.setConfiguration({ ...current, iceServers });
  return true;
}
