import { useEffect, useState } from "react";
import useHardwareSuspended from "../../../hooks/useHardwareSuspended";
import { acquireMicrophone } from "../../../services/microphoneCapture";
import { closeAudioContext, closeAudioContextQuietly } from "../../../utils/audio-context";
import { detectMidiFromAnalyser } from "../utils/pitch";

export default function usePitchDetection({
  isPlaying,
  monitorInputDeviceId,
  getLocalVoiceStream
}) {
  const hardwareSuspended = useHardwareSuspended();
  const [sungMidi, setSungMidi] = useState(null);
  const [isPitchDetected, setIsPitchDetected] = useState(false);
  const [isPitchAttacking, setIsPitchAttacking] = useState(false);
  const [pitchRestProgress, setPitchRestProgress] = useState(1);
  useEffect(() => {
    if (!isPlaying || hardwareSuspended || !navigator.mediaDevices?.getUserMedia) {
      setSungMidi(null);
      setIsPitchDetected(false);
      setIsPitchAttacking(false);
      setPitchRestProgress(1);
      return undefined;
    }
    let cancelled = false;
    let animationFrameId = 0;
    let ownsContext = false;
    let microphoneLease;
    let stream;
    let context;
    let sourceNode;
    let lastMeasurementAt = 0;
    let lastAnimationAt = 0;
    let lastRenderAt = 0;
    let lastVoicedAt = 0;
    let targetMidi = null;
    let displayedMidi = null;
    let restStartedAt = 0;
    let attackUntil = 0;
    const recentMidi = [];
    const resetPitch = () => {
      setSungMidi(null);
      setIsPitchDetected(false);
      setIsPitchAttacking(false);
      setPitchRestProgress(1);
    };
    resetPitch();
    const start = async () => {
      try {
        if (getLocalVoiceStream) {
          stream = await getLocalVoiceStream();
          if (!stream) return;
        } else {
          microphoneLease = await acquireMicrophone(monitorInputDeviceId, {
            disabledEffects: true
          });
          stream = microphoneLease.stream;
        }
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        context = new AudioContextClass({ latencyHint: "interactive" });
        ownsContext = true;
        if (cancelled) {
          // Cancellation can only interleave with the awaited capture above,
          // so this stream is necessarily owned by this effect.
          await microphoneLease?.release();
          if (ownsContext) await closeAudioContext(context);
          return;
        }
        if (context.state === "suspended") await context.resume();
        if (cancelled) return;
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.2;
        sourceNode = context.createMediaStreamSource(stream);
        sourceNode.connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);
        const updatePitch = (timestamp) => {
          if (cancelled) return;
          if (timestamp - lastMeasurementAt >= 35) {
            lastMeasurementAt = timestamp;
            const detectedMidi = detectMidiFromAnalyser(analyser, buffer, context.sampleRate);
            if (Number.isFinite(detectedMidi)) {
              recentMidi.push(detectedMidi);
              if (recentMidi.length > 3) recentMidi.shift();
              const sortedMidi = [...recentMidi].sort((left, right) => left - right);
              const medianMidi = sortedMidi[Math.floor(sortedMidi.length / 2)];
              targetMidi = Number.isFinite(targetMidi)
                ? targetMidi + (medianMidi - targetMidi) * 0.42
                : medianMidi;
              const wasResting = restStartedAt > 0 || !Number.isFinite(displayedMidi);
              lastVoicedAt = timestamp;
              restStartedAt = 0;
              if (wasResting) {
                displayedMidi = targetMidi;
                setSungMidi(targetMidi);
                attackUntil = timestamp + 130;
                setIsPitchAttacking(true);
              }
              setIsPitchDetected(true);
              setPitchRestProgress(0);
            }
          }
          if (timestamp - lastVoicedAt > 110) {
            targetMidi = null;
            if (!restStartedAt && Number.isFinite(displayedMidi)) {
              restStartedAt = timestamp;
              setIsPitchDetected(false);
              setIsPitchAttacking(false);
            }
          }
          if (attackUntil && timestamp >= attackUntil) {
            attackUntil = 0;
            setIsPitchAttacking(false);
          }
          if (Number.isFinite(targetMidi)) {
            const elapsedSeconds = Math.min(
              0.05,
              Math.max(0.001, (timestamp - lastAnimationAt) / 1000)
            );
            const maxStep = 22 * elapsedSeconds;
            const difference = targetMidi - displayedMidi;
            displayedMidi += Math.max(-maxStep, Math.min(maxStep, difference));
            if (timestamp - lastRenderAt >= 15) {
              setSungMidi(displayedMidi);
              lastRenderAt = timestamp;
            }
          } else {
            // A zero rest start only repeats the already-rendered reset state.
            // Stryker disable next-line ConditionalExpression
            if (restStartedAt) {
              const restProgress = Math.min(1, (timestamp - restStartedAt) / 380);
              if (timestamp - lastRenderAt >= 32) {
                setPitchRestProgress(restProgress);
                lastRenderAt = timestamp;
              }
              if (restProgress >= 1) {
                displayedMidi = null;
                recentMidi.length = 0;
                setSungMidi(null);
                restStartedAt = 0;
              }
            }
          }
          lastAnimationAt = timestamp;
          animationFrameId = requestAnimationFrame(updatePitch);
        };
        animationFrameId = requestAnimationFrame(updatePitch);
      } catch {
        microphoneLease?.release();
        if (ownsContext) closeAudioContextQuietly(context);
        ownsContext = false;
        // Pitch feedback is optional; the state was reset before startup.
      }
    };
    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrameId);
      try {
        sourceNode.disconnect();
      } catch {
        // The graph may be absent or already disconnected by the browser.
      }
      microphoneLease?.release();
      if (ownsContext) closeAudioContextQuietly(context);
    };
  }, [isPlaying, hardwareSuspended, monitorInputDeviceId, getLocalVoiceStream]);
  return { sungMidi, isPitchDetected, isPitchAttacking, pitchRestProgress };
}
