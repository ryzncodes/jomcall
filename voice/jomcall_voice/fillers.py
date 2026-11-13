"""Fixed spoken lines: fillers, the trouble line, the repeat request, the goodbye.

The worker never invents answer content. Everything it may say on its own is
in this file, in four languages: ms, en, manglish, zh.
"""

from __future__ import annotations

import random
import re

LANGUAGES = ("ms", "en", "manglish", "zh")

# Neutral acknowledgements: two words at most.
NEUTRAL: dict[str, list[str]] = {
    "ms": ["Baik.", "Sekejap ya.", "Okey."],
    "en": ["One moment.", "Sure.", "Okay."],
    "manglish": ["Okay lah.", "Wait ah.", "Sure sure."],
    "zh": ["好的。", "稍等。", "嗯，好。"],
}

# Action fillers. "{detail}" lines are used only when a detail is given.
LINES: dict[str, dict[str, list[str]]] = {
    "check_availability": {
        "ms": [
            "Saya semak kekosongan sekarang ya.",
            "Sekejap, saya tengok jadual dulu.",
            "Baik, saya periksa slot yang ada.",
            "Saya semak dulu sama ada {detail} masih kosong.",
        ],
        "en": [
            "Let me check what is open.",
            "One moment, I am looking at the schedule.",
            "Checking the available times now.",
            "Let me see if {detail} is still free.",
        ],
        "manglish": [
            "Wait ah, I check the slots first.",
            "Okay lah, I see what is free now.",
            "Sekejap, I tengok schedule dulu.",
            "Let me check if {detail} still got space.",
        ],
        "zh": [
            "我现在帮您查一下有没有空位。",
            "请稍等，我看看时间表。",
            "好的，我检查一下可预约的时间。",
            "我看看{detail}还有没有空位。",
        ],
    },
    "book_slot": {
        "ms": [
            "Baik, saya tempah slot itu sekarang.",
            "Sekejap, saya masukkan tempahan awak.",
            "Saya uruskan tempahan itu ya.",
            "Saya tempah {detail} untuk awak sekarang.",
        ],
        "en": [
            "Alright, I am booking that slot now.",
            "One moment while I save your booking.",
            "Let me get that booked for you.",
            "I am booking {detail} for you now.",
        ],
        "manglish": [
            "Okay, I book that slot for you now.",
            "Wait ah, I masukkan your booking.",
            "Can lah, I settle the booking first.",
            "I book {detail} for you now ah.",
        ],
        "zh": [
            "好的，我现在帮您预约这个时段。",
            "请稍等，我把您的预约记下来。",
            "我来帮您安排预约。",
            "我现在帮您预约{detail}。",
        ],
    },
    "take_message": {
        "ms": [
            "Baik, saya catatkan pesanan itu.",
            "Sekejap, saya tulis mesej awak.",
            "Saya simpan pesanan itu untuk pasukan kami.",
        ],
        "en": [
            "Alright, I am noting down your message.",
            "One moment while I write that down.",
            "I will pass that message to the team.",
        ],
        "manglish": [
            "Okay, I note down your message first.",
            "Wait ah, I tulis your message.",
            "Can lah, I pass this to the team.",
        ],
        "zh": [
            "好的，我把您的留言记下来。",
            "请稍等，我写下来。",
            "我会把这个留言转告我们的团队。",
        ],
    },
    "handoff_to_human": {
        "ms": [
            "Baik, saya sambungkan awak kepada staf kami.",
            "Sekejap, saya hubungi seorang staf.",
            "Saya cuba panggil staf kami sekarang.",
        ],
        "en": [
            "Alright, I am connecting you to our staff.",
            "One moment while I get someone from the team.",
            "Let me try to reach a staff member now.",
        ],
        "manglish": [
            "Okay, I connect you to our staff now.",
            "Wait ah, I call someone from the team.",
            "Can lah, I try reach our staff first.",
        ],
        "zh": [
            "好的，我现在帮您转接我们的同事。",
            "请稍等，我找一位同事过来。",
            "我试着联系我们的工作人员。",
        ],
    },
    "search_knowledge": {
        "ms": [
            "Sekejap, saya semak maklumat itu.",
            "Baik, saya cari jawapannya dulu.",
            "Saya tengok maklumat kedai sekejap ya.",
        ],
        "en": [
            "One moment, let me look that up.",
            "Alright, I am checking our information.",
            "Let me find the answer for you.",
        ],
        "manglish": [
            "Wait ah, I check the info first.",
            "Okay, I cari the answer for you.",
            "Sekejap, I look at our details lah.",
        ],
        "zh": [
            "请稍等，我查一下资料。",
            "好的，我先找找答案。",
            "我看一下我们店里的信息。",
        ],
    },
}

TROUBLE: dict[str, str] = {
    "ms": "Maaf, saya ada masalah sedikit. Boleh cuba lagi sekali?",
    "en": "Sorry, I am having a little trouble. Could you try that once more?",
    "manglish": "Sorry ah, I got a bit of problem. Can you try one more time?",
    "zh": "不好意思，我这边出了点问题。可以请您再说一次吗？",
}

REPEAT: dict[str, str] = {
    "ms": "Maaf, saya tak dengar dengan jelas. Boleh ulang sekali lagi?",
    "en": "Sorry, I did not catch that. Could you say it again?",
    "manglish": "Sorry ah, I never catch that. Can say again?",
    "zh": "不好意思，我没听清楚。可以请您再说一遍吗？",
}

GOODBYE: dict[str, str] = {
    "ms": "Terima kasih kerana menelefon. Jumpa lagi.",
    "en": "Thank you for calling. Goodbye.",
    "manglish": "Thank you for calling ah. Bye bye.",
    "zh": "谢谢您来电，再见。",
}

_DETAIL_MAX = 60
_CTRL = re.compile(r"[\x00-\x1f\x7f{}]+")


def _lang(language: str) -> str:
    return language if language in LANGUAGES else "en"


def _clean(detail: str) -> str:
    return _CTRL.sub(" ", detail).strip()[:_DETAIL_MAX].strip()


def choose(
    action: str | None, language: str, last: str | None, detail: str | None
) -> str | None:
    """Pick a filler line. `action` None means a neutral acknowledgement.

    Never returns `last` when another line exists. With `detail`, prefers a line
    that carries it; an action with no such line falls back to a plain one.
    """
    lang = _lang(language)
    if action is None:
        pool = list(NEUTRAL[lang])
    else:
        lines = LINES.get(action, {}).get(lang)
        if not lines:
            return None
        cleaned = _clean(detail) if detail else ""
        with_detail = [x for x in lines if "{detail}" in x]
        plain = [x for x in lines if "{detail}" not in x]
        if cleaned and with_detail:
            pool = [x.replace("{detail}", cleaned) for x in with_detail]
        else:
            pool = plain
    fresh = [x for x in pool if x != last]
    if not fresh and action is not None:
        # Only one detail line and it was just used: use a plain line instead.
        plain = [x for x in LINES[action][lang] if "{detail}" not in x]
        fresh = [x for x in plain if x != last]
    if not fresh:
        fresh = pool
    return random.choice(fresh)


# --- Filler-only language guess -------------------------------------------
# This is NOT language identification for the conversation (the brain decides
# that). It only picks which language the filler line is in, so it stays tiny.
_MALAY = frozenset(
    "saya boleh tak tidak nak mahu esok pukul hari ini itu dan untuk dengan "
    "awak kamu anda tolong sila terima kasih macam mana berapa bila ada tempah "
    "kedai buka tutup harga".split()
)
_PARTICLES = frozenset("lah leh lor kan ke meh sia wor hor".split())
_WORD = re.compile(r"[a-z']+")


def guess_language(text: str) -> str:
    if any("一" <= ch <= "鿿" for ch in text):
        return "zh"
    words = _WORD.findall(text.lower())
    malay = sum(w in _MALAY for w in words)
    if any(w in _PARTICLES for w in words):
        return "manglish"
    if malay >= 2 or (malay == 1 and len(words) <= 2):
        return "ms"
    return "en"
