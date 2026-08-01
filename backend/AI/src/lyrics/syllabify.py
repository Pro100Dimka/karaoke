"""
Слогоразбивка текста для разбиения долгих нот (см. src/build/split_notes.py).

ЗАЧЕМ: whisper/whisperx дают тайминги только на уровне СЛОВА
(lyricsSync.json: words[].start/end), а не слога. Если певец держит
одну ноту на протяжении целого многослогового слова или фразы
("широкий город магистрали и дома" на одной высоте), из тайминга
одного слова нельзя напрямую узнать, где именно во времени начинается
каждый слог — реального forced-alignment на уровне слога в пайплайне
нет.

ЭВРИСТИКА (не проверено на реальном аудио в этой среде — нет доступа
к librosa/аудио): делим слово на слоги по гласным (см. syllabify_word),
затем делим временной интервал слова между слогами ПРОПОРЦИОНАЛЬНО
числу букв в каждом слоге. Это грубое приближение (согласные и гласные
не звучат одинаковое время, ударный слог обычно длиннее), но для нашей
задачи — понять, СКОЛЬКО слогов легло на одну ноту и примерно ГДЕ
провести границы, чтобы retrigger'нуть ноту — точность на уровне
десятков миллисекунд не критична: границы используются только чтобы
разбить одну лежащую ноту на несколько того же тона, а не чтобы
заново оценивать высоту.

Правило слогоразбивки (стандартное для русской орфографии): граница
идёт сразу ПОСЛЕ каждой гласной, кроме последней в слове — то есть
согласные между двумя гласными всегда отходят к следующему слогу
(открытый слог), а хвост согласных после последней гласной остаётся
в последнем слоге. Буква "й" гласной не считается (это согласный
глайд), "ь"/"ъ" тоже не гласные.

Примеры: "молоко" -> мо-ло-ко, "магистрали" -> ма-ги-стра-ли,
"город" -> го-род, "широкий" -> ши-ро-кий.
"""

VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")


def syllabify_word(word: str) -> list[str]:
    """Разбивает слово на слоги (список подстрок, вместе дающих исходное
    слово без потерь). Слово без гласных (междометие, отдельный знак
    препинания) возвращается как один "слог" — само слово целиком."""
    vowel_idx = [i for i, ch in enumerate(word) if ch in VOWELS]
    if len(vowel_idx) <= 1:
        return [word] if word else []

    boundaries = [0] + [i + 1 for i in vowel_idx[:-1]] + [len(word)]
    return [word[boundaries[i]:boundaries[i + 1]] for i in range(len(boundaries) - 1)]


def split_word_span_into_syllables(word: str, start: float, end: float) -> list[dict]:
    """
    Делит временной интервал [start, end] одного слова на подынтервалы —
    по одному на слог, пропорционально числу букв в слоге. Возвращает
    список {"text", "start", "end"}, отсортированный по времени.
    """
    syllables = syllabify_word(word)
    if not syllables:
        return []
    if len(syllables) == 1 or end <= start:
        return [{"text": word, "start": start, "end": end}]

    total_chars = sum(len(s) for s in syllables)
    duration = end - start
    spans = []
    cursor = start
    for i, syl in enumerate(syllables):
        syl_end = end if i == len(syllables) - 1 else cursor + duration * (len(syl) / total_chars)
        spans.append({"text": syl, "start": round(cursor, 3), "end": round(syl_end, 3)})
        cursor = syl_end
    return spans


def build_syllable_spans(lyrics_lines: list) -> list[dict]:
    """
    Проходит по всем строкам lyricsSync.json (нужны word-level тайминги,
    т.е. поле "words" на строку — см. src/lyrics/sync.py) и строит
    плоский, отсортированный по времени список слоговых интервалов на
    всю песню: [{"text", "start", "end"}, ...].

    Строки/слова без word-level таймингов (words отсутствует или пуст)
    пропускаются — для них split_notes.py просто не найдёт внутренних
    границ и оставит ноты как есть (без разбиения), это безопасный
    fallback, а не ошибка.
    """
    spans = []
    for line in lyrics_lines or []:
        for w in line.get("words", []) or []:
            word = (w.get("word") or "").strip()
            if not word:
                continue
            start = w.get("start")
            end = w.get("end")
            if start is None or end is None or end <= start:
                continue
            spans.extend(split_word_span_into_syllables(word, float(start), float(end)))
    spans.sort(key=lambda s: s["start"])
    return spans
