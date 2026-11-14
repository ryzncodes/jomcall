import pytest

from jomcall_voice import fillers

ACTIONS = [
    "check_availability",
    "book_slot",
    "take_message",
    "handoff_to_human",
    "search_knowledge",
]
LANGUAGES = ["ms", "en", "manglish", "zh"]


@pytest.mark.parametrize("language", LANGUAGES)
@pytest.mark.parametrize("action", ACTIONS)
def test_every_action_has_three_lines_per_language(action, language):
    assert len(fillers.LINES[action][language]) >= 3


def test_choose_returns_a_malay_line_for_the_action():
    line = fillers.choose("check_availability", "ms", None, None)
    assert line in fillers.LINES["check_availability"]["ms"]


@pytest.mark.parametrize("language", LANGUAGES)
@pytest.mark.parametrize("action", ACTIONS + [None])
def test_never_repeats_the_last_line(action, language):
    for _ in range(40):
        first = fillers.choose(action, language, None, None)
        second = fillers.choose(action, language, first, None)
        assert first and second and second != first


def test_detail_is_woven_into_the_line():
    for _ in range(20):
        line = fillers.choose("check_availability", "ms", None, "esok pukul sepuluh")
        assert line is not None and "esok pukul sepuluh" in line


def test_detail_falls_back_when_an_action_has_no_detail_line():
    line = fillers.choose("handoff_to_human", "en", None, "tomorrow")
    assert line in fillers.LINES["handoff_to_human"]["en"]


def test_lines_without_detail_never_carry_a_placeholder():
    for _ in range(40):
        assert "{detail}" not in fillers.choose("book_slot", "en", None, None)


@pytest.mark.parametrize("language", LANGUAGES)
def test_neutral_lines_are_at_most_two_words(language):
    lines = fillers.NEUTRAL[language]
    assert len(lines) >= 3
    for line in lines:
        assert len(line.split()) <= 2 or (language == "zh" and len(line) <= 4)


def test_unknown_language_falls_back_to_english():
    assert fillers.choose(None, "fr", None, None) in fillers.NEUTRAL["en"]


def test_detail_is_trimmed_and_cleaned():
    line = fillers.choose("book_slot", "en", None, "  10am\n\t{detail}  " + "x" * 200)
    assert "\n" not in line and "\t" not in line
    assert len(line) < 200


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Kedai buka pukul berapa", ("ms", True)),
        ("Boleh ke esok?", ("ms", True)),
        ("Kedai buka pukul berapa, ada appointment?", ("ms", True)),
        ("Can book tomorrow ah, boleh?", ("manglish", True)),
        ("can you check the slot lah", ("manglish", True)),
        ("What time do you open?", ("en", True)),
        ("I would like to book a table tomorrow", ("en", True)),
        ("你好，我想订位", ("zh", True)),
        ("Okay.", (None, False)),
        ("Ok lah", (None, False)),  # a lone particle carries no language evidence
        ("Hello", (None, False)),
        ("", (None, False)),
        ("no markers here at all just words", (None, False)),
    ],
)
def test_guess_is_confident_only_with_clear_evidence(text, expected):
    assert fillers.guess(text) == expected


def test_no_malay_marker_alone_is_not_english():
    assert fillers.guess("Okay then") == (None, False)


def test_ke_and_kan_alone_do_not_make_manglish():
    assert fillers.guess("Betul kan") == ("ms", True)
    assert fillers.guess("Ada ke") == ("ms", True)
