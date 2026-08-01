import pytest
from pydantic import ValidationError

import schemas


def test_lyrics_update_accepts_synced_lyrics():
    payload = schemas.LyricsUpdate.model_validate(
        {
            "lyrics": [
                {
                    "text": "Hello world",
                    "start": 1.0,
                    "end": 2.0,
                    "words": [
                        {"word": "Hello", "start": 1.0, "end": 1.4},
                        {"word": "world", "start": 1.5, "end": 2.0},
                    ],
                }
            ]
        }
    )

    assert payload.lyrics[0].words[1].word == "world"


@pytest.mark.parametrize(
    "payload",
    [
        {"lyrics": {"text": "not a list"}},
        {"lyrics": [{"text": "bad", "start": 2, "end": 1, "words": []}]},
        {
            "lyrics": [
                {
                    "text": "bad word",
                    "start": 0,
                    "end": 2,
                    "words": [{"word": "bad", "start": 1, "end": 0.5}],
                }
            ]
        },
    ],
)
def test_lyrics_update_rejects_invalid_timing_or_shape(payload):
    with pytest.raises(ValidationError):
        schemas.LyricsUpdate.model_validate(payload)
