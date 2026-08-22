/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { createActor } from "xstate";
import { describe, expect, test } from "vitest";
import usePlaybackMachine, { playbackMachine } from "../src/pages/Karaoke/hooks/usePlaybackMachine.js";

const transition = (actor, event, state) => {
  actor.send({ type: event });
  expect(actor.getSnapshot().value).toBe(state);
};

describe("karaoke playback machine", () => {
  test("models the complete playback lifecycle", () => {
    const actor = createActor(playbackMachine).start();
    expect(actor.getSnapshot().value).toBe("idle");
    [
      ["START", "starting"],
      ["PLAYED", "playing"],
      ["PAUSE", "pausing"],
      ["PAUSED", "paused"],
      ["START", "starting"],
      ["PLAYED", "playing"],
      ["STOP", "stopping"],
      ["STOPPED", "idle"]
    ].forEach(([event, state]) => transition(actor, event, state));
  });

  test("recovers deterministically from media failures", () => {
    const actor = createActor(playbackMachine).start();
    transition(actor, "PLAYED", "playing");
    transition(actor, "FAILED", "failed");
    transition(actor, "START", "starting");
    transition(actor, "FAILED", "failed");
    transition(actor, "RESET", "idle");
  });

  test("exposes stable React commands for media integrations", () => {
    const hook = renderHook(() => usePlaybackMachine());
    const command = (name, state, argument) => {
      act(() => hook.result.current[name](argument));
      expect(hook.result.current.phase).toBe(state);
    };
    expect(hook.result.current.isPlaying).toBe(false);
    command("start", "starting");
    command("played", "playing");
    expect(hook.result.current.isPlaying).toBe(true);
    command("pause", "pausing");
    command("paused", "paused");
    command("setPlaying", "playing", true);
    command("stop", "stopping");
    command("stopped", "idle");
    command("setPlaying", "playing", true);
    command("setPlaying", "paused", false);
    command("start", "starting");
    command("fail", "failed");
    command("reset", "idle");
  });
});
