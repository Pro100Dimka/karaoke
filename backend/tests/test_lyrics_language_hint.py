from AI.pipeline import _lyrics_language_hint


def test_russian_title_forces_russian_asr():
    assert _lyrics_language_hint("TRITIA 31-я весна") == "ru"


def test_ukrainian_title_forces_ukrainian_asr():
    assert _lyrics_language_hint("Океан Ельзи Обійми") == "uk"


def test_latin_title_keeps_auto_detection():
    assert _lyrics_language_hint("Muse Uprising") is None
