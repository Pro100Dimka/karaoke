// Shared echo/delivery guard for room state and transport commands.
export function createRoomSyncChannel(initialState) {
  let sent = initialState === undefined ? null : JSON.stringify(initialState);
  let remoteTarget = null;
  const commands = new Set();
  return {
    receiveState(remote, current) {
      const signature = JSON.stringify(remote);
      if (signature === JSON.stringify(current)) {
        remoteTarget = null;
        sent = signature;
        return false;
      }
      remoteTarget = signature;
      return true;
    },
    shouldSend(state) {
      const signature = JSON.stringify(state);
      if (remoteTarget !== null) {
        if (remoteTarget === signature) {
          sent = signature;
          remoteTarget = null;
        }
        return false;
      }
      if (sent === signature) return false;
      sent = signature;
      return true;
    },
    acceptCommand(id) {
      if (!id) return true;
      if (commands.has(id)) return false;
      commands.add(id);
      if (commands.size > 256) commands.delete(commands.values().next().value);
      return true;
    },
    cancelCommand(id) {
      commands.delete(id);
    }
  };
}
