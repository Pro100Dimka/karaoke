from __future__ import annotations

import numpy as np

from AI.music_structure import find_section_reprise


def test_section_reprise_finds_the_opening_pattern_inside_the_outro():
    rng = np.random.default_rng(42)
    features = rng.normal(0, 0.03, (8, 260))
    opening = rng.normal(0, 1, (8, 32))
    features[:, 20:52] += opening
    features[:, 198:230] += opening

    match = find_section_reprise(
        features,
        frames_per_second=2.0,
        template_start=10.0,
        template_end=26.0,
        search_start=70.0,
        search_end=125.0,
    )

    assert match is not None
    assert match.start == 99.0
    assert match.similarity > 0.95


def test_section_reprise_rejects_an_unrelated_outro():
    rng = np.random.default_rng(84)
    features = rng.normal(0, 1, (8, 240))

    assert find_section_reprise(
        features,
        frames_per_second=2.0,
        template_start=5.0,
        template_end=20.0,
        search_start=70.0,
        search_end=115.0,
        minimum_similarity=0.9,
    ) is None
