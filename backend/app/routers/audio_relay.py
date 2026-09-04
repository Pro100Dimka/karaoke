"""WebSocket bridge of processed monitor audio to the browser, for the
WebRTC room (see the DSP-unification plan, Task A). A pure byte-pump: it
does not decode, transform, or make sense of the audio itself -- it only
forwards whatever app.services.audio_service.subscribe_monitor_relay()
hands it, re-encoded with the same wire format monitor_worker.py's
RelayLink used to send it to audio_service in the first place.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
import os
import queue

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services import audio_service
from app.services.audio_relay_protocol import encode_frame

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audio", tags=["audio"])

# Read the same way app.main reads it for the HTTP X-ADVoice-Token check.
# Recomputed here (rather than imported from app.main) to avoid a circular
# import -- app.main.app.include_router(audio_relay.router) imports this
# module, so this module cannot import back from app.main.
_API_TOKEN = os.environ.get("SONGAPP_API_TOKEN", "")

# A browser WebSocket constructor cannot set the X-ADVoice-Token header every
# other endpoint uses, so the launch token travels as a query parameter for
# this one connection instead -- see audio_service.subscribe_monitor_relay.
_NO_RELAY_CLOSE_CODE = 4004
_POLL_TIMEOUT_SECONDS = 1.0


def _token_is_valid(token: str | None) -> bool:
    if not _API_TOKEN:
        return True
    return bool(token) and hmac.compare_digest(token, _API_TOKEN)


@router.websocket("/direct-monitor/relay")
async def monitor_relay(websocket: WebSocket) -> None:
    if not _token_is_valid(websocket.query_params.get("token")):
        await websocket.close(code=1008)
        return

    subscription = audio_service.subscribe_monitor_relay()
    if subscription is None:
        await websocket.accept()
        await websocket.close(code=_NO_RELAY_CLOSE_CODE, reason="monitor unavailable")
        return

    relay, subscriber = subscription
    await websocket.accept()

    async def pump_frames() -> None:
        while True:
            try:
                stream_id, sample_rate, samples = await asyncio.to_thread(
                    subscriber.get, True, _POLL_TIMEOUT_SECONDS
                )
            except queue.Empty:
                continue
            await websocket.send_bytes(encode_frame(stream_id, sample_rate, samples))

    async def wait_for_disconnect() -> None:
        with contextlib.suppress(WebSocketDisconnect):
            while True:
                await websocket.receive()

    pump_task = asyncio.create_task(pump_frames())
    disconnect_task = asyncio.create_task(wait_for_disconnect())
    try:
        await asyncio.wait({pump_task, disconnect_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        pump_task.cancel()
        disconnect_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await pump_task
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await disconnect_task
        relay.unsubscribe(subscriber)
        with contextlib.suppress(Exception):
            await websocket.close()
