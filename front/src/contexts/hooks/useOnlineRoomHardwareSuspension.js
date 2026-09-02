import { useEffect } from "react";
import { onHardwareSuspensionChange } from "../../utils/platform";

export default function useOnlineRoomHardwareSuspension({
  requestMicrophoneAccess,
  stopSpeakingMeter,
  voiceRef
}) {
  useEffect(() => {
    let resumeMicrophone = false;
    return onHardwareSuspensionChange((suspended) => {
      const voice = voiceRef.current;
      if (suspended) {
        resumeMicrophone = Boolean(voice?.stream || voice?.startPromise);
        stopSpeakingMeter("local");
        voice?.suspendMicrophone?.().catch(() => {});
      } else if (resumeMicrophone && voiceRef.current === voice) {
        resumeMicrophone = false;
        requestMicrophoneAccess();
      }
    });
  }, [requestMicrophoneAccess, stopSpeakingMeter, voiceRef]);
}
