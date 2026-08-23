import numpy as np
import soundfile as sf

from AI.models import Word
from AI.word_voicing import anchor_words_to_voice, voice_activity_intervals


def _write_track(path, spans, span=40.0, rate=8000, loud=0.2, quiet=0.0005):
    samples = np.full(int(span * rate), quiet, dtype=np.float64)
    for start, end in spans:
        samples[int(start * rate):int(end * rate)] = loud
    sf.write(path, samples, rate)


def test_voice_activity_intervals_merges_close_frames_and_splits_on_gaps(tmp_path):
    path = tmp_path / "vocals.wav"
    _write_track(path, [(1.0, 1.2), (1.23, 1.4), (3.0, 3.1)])

    intervals = voice_activity_intervals(path)

    assert len(intervals) == 2
    first_start, first_end = intervals[0]
    assert abs(first_start - 1.0) < 0.03
    assert first_end >= 1.35


def test_a_lone_word_is_clamped_to_its_voice_activity_interval():
    intervals = [(27.8, 28.9)]
    words = [Word(28.0, 28.5, "слово", index=0)]

    result = anchor_words_to_voice(words, intervals, span=40.0)

    assert result[0].start == 27.8
    assert result[0].end == 28.9


def test_a_squeezed_multisyllable_word_is_given_its_fair_share_of_the_phrase():
    # Reproduces the reported "Пригоди" case: the aligner squeezed a
    # 3-syllable word down to a sliver while its 1-syllable neighbour got
    # more room than it needed, even though the whole phrase's span (from
    # voice-activity) was roughly right.
    intervals = [(28.0, 28.6)]
    words = [
        Word(28.0, 28.45, "трисложне", index=0),  # 3 vowels: и,о,е
        Word(28.45, 28.6, "зі", index=1),  # 1 vowel: і
    ]

    result = anchor_words_to_voice(words, intervals, span=40.0)

    durations = [w.end - w.start for w in result]
    assert result[0].start == 28.0
    assert abs(result[-1].end - 28.6) < 1e-6
    # 3 syllables vs 1 syllable -> roughly a 3:1 split of the 0.6s phrase
    assert abs(durations[0] - 0.45) < 0.02
    assert abs(durations[1] - 0.15) < 0.02


def test_equal_syllable_count_words_split_the_phrase_evenly():
    intervals = [(10.0, 11.0)]
    words = [
        Word(10.0, 10.9, "мама", index=0),  # 2 vowels
        Word(10.9, 11.0, "тато", index=1),  # 2 vowels
    ]

    result = anchor_words_to_voice(words, intervals, span=40.0)

    assert abs(result[0].start - 10.0) < 1e-6
    assert abs(result[0].end - 10.5) < 1e-6
    assert abs(result[1].start - 10.5) < 1e-6
    assert abs(result[1].end - 11.0) < 1e-6


def test_words_with_no_overlapping_voice_are_left_alone():
    intervals = [(20.0, 21.0)]
    words = [Word(1.0, 1.4, "a", index=0)]

    result = anchor_words_to_voice(words, intervals, span=40.0)

    assert (result[0].start, result[0].end) == (1.0, 1.4)


def test_output_stays_monotonic_and_valid_across_group_boundaries():
    intervals = [(1.0, 2.0), (3.0, 4.0)]
    words = [
        Word(1.1, 1.4, "a", index=0),
        Word(1.4, 1.9, "b", index=1),
        Word(2.5, 2.6, "gap", index=2),  # not voiced anywhere -> untouched
        Word(3.1, 3.5, "c", index=3),
        Word(3.5, 3.9, "d", index=4),
    ]

    result = anchor_words_to_voice(words, intervals, span=40.0)

    for i in range(1, len(result)):
        assert result[i].start + 1e-6 >= result[i - 1].start
    for word in result:
        assert word.end > word.start


def test_no_voice_activity_returns_words_unchanged():
    words = [Word(1.0, 1.4, "a", index=0)]

    result = anchor_words_to_voice(words, [], span=40.0)

    assert result == words


def test_silent_track_returns_no_intervals(tmp_path):
    path = tmp_path / "silent.wav"
    _write_track(path, [])

    assert voice_activity_intervals(path) == []
