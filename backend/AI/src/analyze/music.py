"""
Шаг 4. Анализ минусовки.
instrumental.wav -> music.json

Рассчитывает: BPM, первую долю, темп, изменение темпа,
размер (4/4, 3/4 ...), тональность, смену тональности.
"""
import argparse
import json
import numpy as np
import librosa

MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def compute_boundary_chroma(chroma: np.ndarray, rms: np.ndarray,
                             boundary_fraction: float = 0.05,
                             energy_gate_ratio: float = 0.15) -> np.ndarray | None:
    """
    ИСПРАВЛЕНО: раньше "граница" трека (первые+последние boundary_fraction
    кадров) усреднялась без учёта громкости. Если интро/аутро — это
    тишина, шум или реверб-хвост (в этой песне так и есть: структура
    выделяет отдельные крошечные блоки 0-1с и ~139-145с), эти почти-
    случайные хрома-вектора всё равно попадали в boundary_chroma_mean
    и с весом boundary_weight=1.5 могли утянуть оценку тоники в сторону
    от неё (не проверено на реальном аудио в этой среде — нужен librosa
    локально, но иначе безопасно: сначала выбрасываем кадры граничной
    зоны, чья громкость намного ниже средней по треку (< energy_gate_ratio
    от максимума RMS), и усредняем только оставшиеся. Если после фильтра
    ничего не осталось (интро/аутро — сплошная тишина), возвращаем None —
    тогда estimate_key просто не будет использовать усиление границ.
    """
    n_frames = chroma.shape[1]
    span = max(1, int(n_frames * boundary_fraction))
    idx = np.concatenate([np.arange(0, span), np.arange(n_frames - span, n_frames)])
    idx = np.unique(idx[(idx >= 0) & (idx < n_frames)])

    rms_at_idx = rms[idx] if len(rms) == n_frames else None
    if rms_at_idx is not None and rms.max() > 0:
        gate = energy_gate_ratio * rms.max()
        kept = idx[rms_at_idx >= gate]
        if len(kept) == 0:
            return None
        idx = kept

    return chroma[:, idx].mean(axis=1)


def compute_bass_chroma(y: np.ndarray, sr: int, cutoff_hz: float = 350.0,
                         fmin_note: str = "C1", n_octaves: int = 3) -> np.ndarray | None:
    """
    Хрома, посчитанная на НИЗКОЧАСТОТНОЙ (басовой) версии сигнала.

    ПОЧЕМУ: полноспектральная хрома (chroma_cqt на всём миксе) отражает
    ВСЁ, что звучит одновременно — мелодию, гармонию, вокал, — и если
    какая-то не-тоническая нота держится долго/громко (например,
    доминанта в мелодии, что очень частый приём), она может перевесить
    в KS-корреляции и увести оценку тональности на "соседнюю" (доминанта
    вместо тоники и т.п. — не только относительный мажор/минор). Бас
    почти всегда играет корень аккорда, особенно на сильных долях и на
    первом/последнем аккорде трека, поэтому хрома, посчитанная только на
    низких частотах, — гораздо более надёжный (хоть и более разреженный)
    сигнал именно для тоники, а не для того, что просто громче всего
    звучит.

    Возвращает None, если scipy недоступен или сигнал слишком короткий
    для устойчивой low-pass фильтрации.
    """
    try:
        from scipy.signal import butter, sosfiltfilt
    except ImportError:
        return None
    if len(y) < sr:
        return None
    sos = butter(4, cutoff_hz, btype="low", fs=sr, output="sos")
    y_bass = sosfiltfilt(sos, y)
    chroma_bass = librosa.feature.chroma_cqt(
        y=y_bass, sr=sr,
        fmin=librosa.note_to_hz(fmin_note),
        n_octaves=n_octaves,
    )
    return chroma_bass.mean(axis=1)


def estimate_key(chroma_mean: np.ndarray, boundary_chroma_mean: np.ndarray = None,
                  boundary_weight: float = 1.5, bass_chroma_mean: np.ndarray = None,
                  bass_weight: float = 2.0):
    """
    Корреляция с профилями Krумhansl-Schmuckler -> лучшая тональность.

    boundary_chroma_mean — усреднённая хрома первых+последних нескольких
    секунд трека. Песни статистически чаще начинаются/заканчиваются на
    тонике или доминанте, так что усиление этих участков помогает
    отличить релятивные мажор/минор (например, C major vs A minor —
    ноты одинаковые, но начало/конец чаще выдают настоящую тонику).

    bass_chroma_mean — усреднённая хрома НИЗКИХ частот (см.
    compute_bass_chroma). ИСПРАВЛЕНО: одной boundary-хромы недостаточно,
    если сама доминанта активно используется и на границах трека тоже —
    тогда усиление границ только усугубляет путаницу тоника/доминанта.
    Басовая хрома добавляет сигнал именно о том, ГДЕ корень аккорда, а
    не о том, что просто громко звучит, поэтому у неё увеличенный вес
    (bass_weight) относительно полноспектральной хромы.

    ДОБАВЛЕНО: раньше функция возвращала только (лучший_ключ, score) —
    если движок ошибался, не было видно, НАСКОЛЬКО близко второе место
    (релятивный мажор/минор или доминанта часто оказываются очень рядом
    по корреляции с "правильным" ключом). Теперь возвращаем ещё top-3
    (score, key) — если счёт победителя выше второго места лишь на
    0.01-0.02, результату не стоит доверять слепо, его нужно проверить
    на слух.

    Возвращает (best_key, best_score, top3), top3 — список (score, key)
    по убыванию score, длиной до 3.
    """
    combined = chroma_mean.copy()
    if boundary_chroma_mean is not None:
        combined = combined + boundary_weight * boundary_chroma_mean
    if bass_chroma_mean is not None:
        combined = combined + bass_weight * bass_chroma_mean

    scored = []
    for i in range(12):
        maj = np.roll(MAJOR_PROFILE, i)
        minr = np.roll(MINOR_PROFILE, i)
        maj_corr = np.corrcoef(combined, maj)[0, 1]
        min_corr = np.corrcoef(combined, minr)[0, 1]
        scored.append((float(maj_corr), f"{NOTE_NAMES[i]} major"))
        scored.append((float(min_corr), f"{NOTE_NAMES[i]} minor"))

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_key = scored[0]
    return best_key, best_score, scored[:3]


def fold_tempo(bpm: float, low: float = 70.0, high: float = 180.0) -> float:
    """
    librosa.beat.beat_track часто ошибается в 2 раза (даёт половинный
    или удвоенный темп относительно того, что реально слышит человек).
    Складываем результат в "человеческий" диапазон 70-180 BPM
    удвоением/делением пополам, сохраняя исходное значение отдельно
    для прозрачности.
    """
    folded = bpm
    while folded < low and folded > 0:
        folded *= 2
    while folded > high:
        folded /= 2
    return folded


def estimate_time_signature(onset_env: np.ndarray, sr: int, bpm: float,
                             hop_length: int = 512):
    """
    Более надёжная оценка размера такта через автокорреляцию onset-огибающей
    на лагах, кратных длительности такта для гипотез 3/4 и 4/4 (и бонусом
    6/8, который на слух часто путают с 3/4). Раньше использовалась
    эвристика на дисперсии силы долей — она давала почти всегда 4/4.

    Идея: если реальный размер N/4, то автокорреляция onset-огибающей
    должна иметь выраженный пик на лаге "N долей" и его кратных (2N, 3N...),
    сильнее, чем у конкурирующих гипотез.

    ИСПРАВЛЕНО (v2): раньше кандидаты сравнивались по сырому значению
    ac[lag]/ac0. Но автокорреляция типичного onset-сигнала в среднем
    затухает с ростом лага — поэтому лаг "3 доли" почти всегда получает
    более высокое сырое значение, чем лаг "4 доли", ПРОСТО потому что он
    короче, независимо от того, какой размер реально в песне. Это
    систематически смещало результат в пользу 3/4 (и вообще в пользу
    меньшего кандидата). Теперь каждый кандидат оценивается не по
    абсолютному значению автокорреляции, а по тому, насколько пик на
    его лаге выступает НАД локальным фоном (средним значением ac в
    небольшой окрестности этого же лага) — это не зависит от общего
    затухания автокорреляции с лагом.
    """
    beat_period_sec = 60.0 / bpm if bpm > 0 else 0.5
    beat_period_frames = max(1, int(round(beat_period_sec * sr / hop_length)))

    max_lag = beat_period_frames * 9
    if len(onset_env) < max_lag * 2:
        return "4/4", 0.0  # трек слишком короткий для надёжной оценки

    ac = librosa.autocorrelate(onset_env, max_size=max_lag)
    ac0 = ac[0] + 1e-9

    def local_prominence(lag: int, half_window: int) -> float:
        """ac[lag] минус средний фон в окне вокруг lag (без самого пика)."""
        lo, hi = max(0, lag - half_window), min(len(ac), lag + half_window + 1)
        window = np.concatenate([ac[lo:lag], ac[lag + 1:hi]])
        baseline = float(np.mean(window)) if len(window) else 0.0
        return float(ac[lag]) - baseline

    half_window = max(1, beat_period_frames // 2)
    candidates = {"3/4": 3, "4/4": 4, "6/8": 6}
    scores = {}
    for label, group in candidates.items():
        proms = []
        for k in (1, 2):
            lag = beat_period_frames * group * k
            if lag < len(ac):
                proms.append(local_prominence(lag, half_window))
        scores[label] = (np.mean(proms) / ac0) if proms else 0.0

    best_label = max(scores, key=scores.get)
    # уверенность считаем от лучшего сырого ac (как раньше) — prominence
    # используется только для ВЫБОРА кандидата, чтобы не переписывать
    # смысл confidence в остальном пайплайне/отчёте
    best_group = candidates[best_label]
    raw_vals = [ac[beat_period_frames * best_group * k] for k in (1, 2)
                if beat_period_frames * best_group * k < len(ac)]
    confidence = float(np.mean(raw_vals) / ac0) if raw_vals else 0.0
    return best_label, confidence


def analyze_music(input_path: str, key_change_window_sec: float = 20.0):
    y, sr = librosa.load(input_path, sr=None, mono=True)

    # Темп и доли
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    # В librosa >= 0.10 tempo может вернуться как массив (даже из одного числа)
    tempo_raw = float(np.atleast_1d(tempo)[0])
    tempo = fold_tempo(tempo_raw)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    first_beat = float(beat_times[0]) if len(beat_times) else 0.0

    # Изменение темпа по окнам (динамический темп)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    try:
        tempo_func = librosa.feature.rhythm.tempo
    except AttributeError:
        tempo_func = librosa.beat.tempo
    dtempo = tempo_func(onset_envelope=onset_env, sr=sr, aggregate=None)
    dtempo = np.array([fold_tempo(float(b)) for b in dtempo])
    tempo_curve = [
        {"time": float(t), "bpm": float(b)}
        for t, b in zip(librosa.frames_to_time(np.arange(len(dtempo)), sr=sr), dtempo)
    ]

    # Размер такта — автокорреляция onset-огибающей (см. estimate_time_signature)
    time_signature, ts_confidence = estimate_time_signature(onset_env, sr, tempo)

    # Тональность в целом, с усилением начала/конца трека (см. estimate_key).
    # boundary-хрома теперь фильтруется по громкости (compute_boundary_chroma),
    # чтобы тишина/шум на границах трека не перетягивала оценку тоники.
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_rms = librosa.feature.rms(
        y=y, hop_length=512, frame_length=2048
    )[0]
    if len(chroma_rms) != chroma.shape[1]:
        chroma_rms = np.interp(
            np.linspace(0, 1, chroma.shape[1]),
            np.linspace(0, 1, len(chroma_rms)),
            chroma_rms,
        )
    boundary_chroma = compute_boundary_chroma(chroma, chroma_rms)
    bass_chroma = compute_bass_chroma(y, sr)
    key, confidence, key_top3 = estimate_key(chroma.mean(axis=1), boundary_chroma,
                                              bass_chroma_mean=bass_chroma)

    # Смена тональности по окнам, со сглаживанием (гистерезисом): считаем
    # смену тональности подтверждённой, только если новое окно повторилось
    # min_repeat раз подряд — иначе это шум/дребезг между релятивными
    # мажором и минором (одинаковый набор нот, разная "тоника"), а не
    # реальная модуляция.
    min_repeat = 2
    raw_windows = []
    hop = int(key_change_window_sec * sr)
    for start in range(0, len(y), hop):
        segment = y[start:start + hop]
        if len(segment) < sr:  # слишком коротко
            continue
        seg_chroma = librosa.feature.chroma_cqt(y=segment, sr=sr)
        seg_key, seg_conf, _ = estimate_key(seg_chroma.mean(axis=1))
        raw_windows.append({"time": round(start / sr, 2), "key": seg_key, "confidence": round(seg_conf, 3)})

    key_changes = []
    confirmed_key = None
    i = 0
    while i < len(raw_windows):
        candidate = raw_windows[i]["key"]
        j = i
        while j < len(raw_windows) and raw_windows[j]["key"] == candidate:
            j += 1
        run_length = j - i
        if candidate != confirmed_key and run_length >= min_repeat:
            key_changes.append({
                "time": raw_windows[i]["time"],
                "key": candidate,
                "confidence": raw_windows[i]["confidence"],
            })
            confirmed_key = candidate
        i = j

    result = {
        "bpm": round(float(tempo), 2),
        "bpm_raw": round(float(tempo_raw), 2),  # необработанное значение от librosa, для отладки
        "first_beat_sec": round(first_beat, 3),
        "tempo_curve": tempo_curve,
        "time_signature": time_signature,
        "time_signature_confidence": round(ts_confidence, 3),
        "key": key,
        "key_confidence": round(confidence, 3),
        "key_candidates": [
            {"key": k, "score": round(s, 3)} for s, k in key_top3
        ],
        "key_changes": key_changes,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description="Анализ минусовки: BPM, тональность, размер")
    parser.add_argument("input", help="instrumental.wav или song.wav")
    parser.add_argument("output", nargs="?", default="music.json")
    args = parser.parse_args()

    result = analyze_music(args.input)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Сохранено: {args.output}")
    print(json.dumps({k: v for k, v in result.items() if k != "tempo_curve"},
                      ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
