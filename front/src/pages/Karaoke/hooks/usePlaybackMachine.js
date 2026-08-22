import { useMachine } from "@xstate/react";
import { useMemo } from "react";
import { createMachine } from "xstate";

export const playbackMachine = createMachine({
  id: "karaokePlayback",
  initial: "idle",
  on: { RESET: ".idle" },
  states: {
    idle: { on: { START: "starting", PLAYED: "playing" } },
    starting: { on: { PLAYED: "playing", FAILED: "failed", PAUSE: "pausing", STOP: "stopping" } },
    playing: { on: { PAUSE: "pausing", PAUSED: "paused", STOP: "stopping", FAILED: "failed" } },
    pausing: { on: { PAUSED: "paused", START: "starting", STOP: "stopping" } },
    paused: { on: { START: "starting", PLAYED: "playing", STOP: "stopping" } },
    stopping: { on: { STOPPED: "idle", FAILED: "failed" } },
    failed: { on: { START: "starting", STOP: "stopping" } }
  }
});

export default function usePlaybackMachine() {
  const [snapshot, send] = useMachine(playbackMachine);
  const actions = useMemo(
    () => ({
      start: () => send({ type: "START" }),
      played: () => send({ type: "PLAYED" }),
      pause: () => send({ type: "PAUSE" }),
      paused: () => send({ type: "PAUSED" }),
      stop: () => send({ type: "STOP" }),
      stopped: () => send({ type: "STOPPED" }),
      fail: () => send({ type: "FAILED" }),
      reset: () => send({ type: "RESET" }),
      setPlaying: (playing) => send({ type: playing ? "PLAYED" : "PAUSED" })
    }),
    [send]
  );
  return { ...actions, phase: snapshot.value, isPlaying: snapshot.matches("playing") };
}
