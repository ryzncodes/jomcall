import math
import struct

from jomcall_voice import audio, config

RATE = config.TTS_SAMPLE_RATE


def pcm(samples):
    return struct.pack(f"<{len(samples)}h", *samples)


def silence(ms):
    return pcm([0] * (RATE * ms // 1000))


def tone(ms, amp=8000):
    return pcm([int(amp * math.sin(i / 5)) for i in range(RATE * ms // 1000)])


def ms_of(data):
    return len(data) * 1000 // (2 * RATE)


def test_trim_keeps_the_voice_and_a_20ms_pad_each_side():
    clip = silence(300) + tone(500) + silence(300)
    out = audio.trim_silence(clip)
    assert abs(ms_of(out) - (500 + 2 * config.TRIM_PAD_MS)) <= 10
    assert out[: len(silence(10))] == silence(10)  # starts in the pad
    assert tone(500)[:200] in out


def test_trim_is_idempotent_so_old_cache_entries_and_new_ones_agree():
    once = audio.trim_silence(silence(300) + tone(500) + silence(300))
    assert audio.trim_silence(once) == once


def test_a_clip_with_no_voiced_sample_is_returned_unchanged_and_non_empty():
    clip = silence(200)
    assert audio.trim_silence(clip) == clip
    assert audio.trim_silence(pcm([1, -1, 2])) == pcm([1, -1, 2])


def test_a_clip_with_no_silence_is_unchanged():
    clip = tone(300)
    assert abs(len(audio.trim_silence(clip)) - len(clip)) <= 2 * 2 * RATE // 100


def test_odd_trailing_byte_is_tolerated():
    assert len(audio.trim_silence(silence(100) + tone(100) + b"\x01")) % 2 == 0


def run_lead(chunks):
    trimmer = audio.LeadTrimmer()
    return b"".join(trimmer.feed(c) for c in chunks) + trimmer.flush()


def test_lead_trimmer_drops_leading_silence_in_any_chunking():
    clip = silence(300) + tone(200)
    for size in (7, 480, 1000, 100_000):
        chunks = [clip[i : i + size] for i in range(0, len(clip), size)]
        out = run_lead(chunks)
        assert tone(200) in out
        assert abs(ms_of(out) - (200 + config.TRIM_PAD_MS)) <= 12


def test_lead_trimmer_never_drops_more_than_the_bound():
    clip = silence(1000) + tone(100)
    out = run_lead([clip])
    assert ms_of(clip) - ms_of(out) <= config.LEAD_TRIM_MAX_MS
    assert out.endswith(tone(100))


def test_lead_trimmer_keeps_quiet_speech_after_the_bound():
    quiet = tone(200, amp=50)  # below the threshold: "silent" to the trimmer
    clip = silence(500) + quiet
    out = run_lead([clip])
    assert quiet in out


def test_lead_trimmer_returns_a_short_all_silent_stream_whole():
    clip = silence(15)
    assert run_lead([clip]) == clip
