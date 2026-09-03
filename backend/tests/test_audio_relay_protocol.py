import numpy as np

from app.services.audio_relay_protocol import STREAM_DRY, STREAM_WET, FrameReader, encode_frame


def test_encode_and_decode_round_trips_a_single_frame():
    samples = np.array([0.1, -0.2, 0.3, -0.4], dtype=np.float32)
    reader = FrameReader()
    reader.feed(encode_frame(STREAM_DRY, 48000.0, samples))
    frames = reader.pop_frames()
    assert len(frames) == 1
    stream_id, sample_rate, decoded = frames[0]
    assert stream_id == STREAM_DRY
    assert sample_rate == 48000.0
    assert np.array_equal(decoded, samples)


def test_reader_waits_for_a_complete_frame_before_yielding_it():
    samples = np.zeros(100, dtype=np.float32)
    payload = encode_frame(STREAM_WET, 44100.0, samples)
    reader = FrameReader()
    reader.feed(payload[:5])
    assert reader.pop_frames() == []
    reader.feed(payload[5:])
    frames = reader.pop_frames()
    assert len(frames) == 1
    assert frames[0][0] == STREAM_WET
    assert len(frames[0][2]) == 100


def test_reader_handles_multiple_frames_arriving_in_one_chunk():
    a = encode_frame(STREAM_DRY, 48000.0, np.array([1.0, 2.0], dtype=np.float32))
    b = encode_frame(STREAM_WET, 48000.0, np.array([3.0], dtype=np.float32))
    reader = FrameReader()
    reader.feed(a + b)
    frames = reader.pop_frames()
    assert [f[0] for f in frames] == [STREAM_DRY, STREAM_WET]
    assert np.array_equal(frames[0][2], [1.0, 2.0])
    assert np.array_equal(frames[1][2], [3.0])


def test_reader_leaves_a_trailing_partial_frame_buffered():
    a = encode_frame(STREAM_DRY, 48000.0, np.array([1.0], dtype=np.float32))
    b = encode_frame(STREAM_WET, 48000.0, np.array([2.0, 3.0], dtype=np.float32))
    reader = FrameReader()
    reader.feed(a + b[:3])
    frames = reader.pop_frames()
    assert len(frames) == 1 and frames[0][0] == STREAM_DRY
    reader.feed(b[3:])
    frames = reader.pop_frames()
    assert len(frames) == 1 and frames[0][0] == STREAM_WET
