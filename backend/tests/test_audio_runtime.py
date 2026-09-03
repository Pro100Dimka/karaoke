import asyncio
import threading

from app.services import audio_runtime


def test_run_on_audio_thread_runs_directly_without_a_bound_loop():
    audio_runtime.bind_main_loop(None)
    calls = []

    def action(x):
        calls.append(x)
        return x * 2

    result = {}

    def worker():
        result["value"] = audio_runtime.run_on_audio_thread(action, 21)

    thread = threading.Thread(target=worker)
    thread.start()
    thread.join()

    assert result["value"] == 42
    assert calls == [21]


def test_run_on_audio_thread_runs_directly_when_already_on_the_main_thread():
    loop = asyncio.new_event_loop()
    audio_runtime.bind_main_loop(loop)
    try:
        assert audio_runtime.run_on_audio_thread(threading.current_thread) is threading.main_thread()
    finally:
        audio_runtime.bind_main_loop(None)
        loop.close()


def test_run_on_audio_thread_marshals_background_calls_onto_the_bound_loop():
    # ASIO drivers bind to whichever thread first loads them (in production,
    # the main thread running the event loop). A call made from a worker
    # thread (like FastAPI's sync-route threadpool) must actually execute on
    # the thread driving the bound loop, not on the calling thread.
    loop = asyncio.new_event_loop()
    audio_runtime.bind_main_loop(loop)
    seen_thread = {}
    result = {}
    try:
        def action():
            seen_thread["thread"] = threading.current_thread()
            return "ok"

        def worker():
            result["value"] = audio_runtime.run_on_audio_thread(action)
            loop.call_soon_threadsafe(loop.stop)

        thread = threading.Thread(target=worker)
        thread.start()
        loop.run_forever()
        thread.join()
    finally:
        audio_runtime.bind_main_loop(None)
        loop.close()

    assert result["value"] == "ok"
    assert seen_thread["thread"] is threading.current_thread()


def test_run_on_audio_thread_propagates_exceptions_from_the_bound_loop():
    loop = asyncio.new_event_loop()
    audio_runtime.bind_main_loop(loop)
    outcome = {}
    try:
        def action():
            raise RuntimeError("boom")

        def worker():
            try:
                audio_runtime.run_on_audio_thread(action)
            except RuntimeError as exc:
                outcome["error"] = str(exc)
            loop.call_soon_threadsafe(loop.stop)

        thread = threading.Thread(target=worker)
        thread.start()
        loop.run_forever()
        thread.join()
    finally:
        audio_runtime.bind_main_loop(None)
        loop.close()

    assert outcome["error"] == "boom"
