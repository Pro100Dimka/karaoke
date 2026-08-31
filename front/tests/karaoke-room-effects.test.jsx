/* @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import useKaraokeRoomEffects from "../src/pages/Karaoke/hooks/useKaraokeRoomEffects";

test("effect broadcasts deduplicate rerenders and resend to new participants", () => {
  const syncUi = vi.fn();
  const props = { room: { id: "room", selfId: "me" }, participantCount: 2, volume: 1, effects: { echo: 0.2 }, syncUi };
  const view = renderHook(useKaraokeRoomEffects, { initialProps: props });
  expect(syncUi).toHaveBeenCalledTimes(1);
  view.rerender({ ...props, effects: { echo: 0.2 } });
  expect(syncUi).toHaveBeenCalledTimes(1);
  view.rerender({ ...props, participantCount: 3 });
  expect(syncUi).toHaveBeenCalledTimes(2);
  view.rerender({ ...props, participantCount: 3, volume: 0.5 });
  expect(syncUi).toHaveBeenLastCalledWith({ participantEffects: { volume: 0.5, echo: 0.2 } });
});

test("effects are not sent outside a room", () => {
  const syncUi = vi.fn();
  renderHook(() => useKaraokeRoomEffects({ room: null, effects: {}, volume: 1, participantCount: 0, syncUi }));
  expect(syncUi).not.toHaveBeenCalled();
});
