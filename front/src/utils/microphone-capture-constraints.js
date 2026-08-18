// Shared base getUserMedia constraints for every microphone capture path in
// the app (room voice, pitch detection, level metering). All three used to
// disagree on noiseSuppression specifically; browsers apply it before any of
// this app's own processing ever sees the signal, so a mismatch there meant
// the mic could sound/measure differently depending on which screen captured
// it. echoCancellation and autoGainControl were already off everywhere --
// autoGainControl constantly renormalizes the level, which defeats both
// pitch detection and level metering.
export const MICROPHONE_CAPTURE_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};
