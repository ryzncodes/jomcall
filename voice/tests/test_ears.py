"""The Deepgram event assembler, driven by a fake event stream and a fake clock."""

import asyncio
from types import SimpleNamespace

from livekit.agents import stt

from jomcall_voice import config
from jomcall_voice.ears import assemble
from test_call import FakeClock, settle

T = stt.SpeechEventType


def ev(kind, text=""):
    return SimpleNamespace(type=kind, alternatives=[SimpleNamespace(text=text)] if text else [])


class Feed:
    """An async event source the test pushes into."""

    def __init__(self):
        self.queue = asyncio.Queue()

    def push(self, kind, text=""):
        self.queue.put_nowait(ev(kind, text))

    def close(self):
        self.queue.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.queue.get()
        if item is None:
            raise StopAsyncIteration
        return item


async def start(feed, clock):
    out = []

    async def run():
        async for e in assemble(feed, sleep=clock.sleep):
            out.append(e)

    task = asyncio.create_task(run())
    await settle()
    return out, task


def transcripts(out):
    return [e.text for e in out if e.kind == "transcript"]


async def test_finals_then_end_of_speech_deliver_the_joined_text_once():
    clock, feed = FakeClock(), Feed()
    out, task = await start(feed, clock)
    feed.push(T.START_OF_SPEECH)
    feed.push(T.FINAL_TRANSCRIPT, "good")
    feed.push(T.FINAL_TRANSCRIPT, "morning")
    feed.push(T.END_OF_SPEECH)
    await settle()
    await clock.advance(5000)
    assert transcripts(out) == ["good morning"]
    task.cancel()


async def test_finals_then_silence_are_delivered_once_after_a_second():
    clock, feed = FakeClock(), Feed()
    out, task = await start(feed, clock)
    feed.push(T.FINAL_TRANSCRIPT, "book me")
    await settle()
    await clock.advance(config.FLUSH_AFTER_FINAL_MS - 50)
    assert transcripts(out) == []
    await clock.advance(100)
    assert transcripts(out) == ["book me"]
    await clock.advance(10_000)
    assert transcripts(out) == ["book me"]
    task.cancel()


async def test_a_late_end_of_speech_does_not_deliver_a_second_time():
    clock, feed = FakeClock(), Feed()
    out, task = await start(feed, clock)
    feed.push(T.FINAL_TRANSCRIPT, "book me")
    await settle()
    await clock.advance(1100)
    feed.push(T.END_OF_SPEECH)
    await settle()
    assert transcripts(out) == ["book me"]
    # and the next utterance is delivered normally
    feed.push(T.FINAL_TRANSCRIPT, "tomorrow")
    feed.push(T.END_OF_SPEECH)
    await settle()
    assert transcripts(out) == ["book me", "tomorrow"]
    task.cancel()


async def test_words_still_arriving_keep_the_utterance_open():
    clock, feed = FakeClock(), Feed()
    out, task = await start(feed, clock)
    feed.push(T.FINAL_TRANSCRIPT, "one")
    await settle()
    for _ in range(4):
        await clock.advance(800)
        feed.push(T.INTERIM_TRANSCRIPT, "two")  # the caller is still talking
        await settle()
    assert transcripts(out) == []
    await clock.advance(1100)
    assert transcripts(out) == ["one"]
    task.cancel()


async def test_noise_with_no_words_ends_as_an_empty_transcript():
    clock, feed = FakeClock(), Feed()
    out, task = await start(feed, clock)
    feed.push(T.START_OF_SPEECH)
    feed.push(T.END_OF_SPEECH)
    await settle()
    assert transcripts(out) == [""]
    assert [e.kind for e in out] == ["speech_start", "transcript"]
    task.cancel()


async def test_interim_words_are_reported_without_their_text():
    clock, feed = FakeClock(), Feed()
    out, task = await start(feed, clock)
    feed.push(T.INTERIM_TRANSCRIPT, "secret words")
    await settle()
    assert [(e.kind, e.text) for e in out] == [("interim", "words")]
    task.cancel()


async def test_a_failing_speech_engine_raises_from_assemble_and_logs_nothing(caplog):
    class Broken:
        def __aiter__(self):
            return self

        async def __anext__(self):
            raise RuntimeError("secret words")

    clock = FakeClock()
    got = []

    async def run():
        async for e in assemble(Broken(), sleep=clock.sleep):
            got.append(e)

    with caplog.at_level("DEBUG"):
        task = asyncio.create_task(run())
        await settle()
        assert task.done() and isinstance(task.exception(), RuntimeError)
        import gc

        gc.collect()
        await settle()
    assert got == [] and not caplog.records
