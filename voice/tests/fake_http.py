"""A tiny HTTP/1.1 server on loopback port 0 for tests (no extra dependency)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Awaitable, Callable


@dataclass
class Request:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes


@dataclass
class Reply:
    status: int = 200
    headers: dict[str, str] = field(default_factory=dict)
    # Chunks are sent as separate HTTP chunks; a float means "pause that long".
    chunks: list[bytes | float] = field(default_factory=list)
    # Keep the response open after the chunks until the client goes away.
    hold_open: bool = False


Handler = Callable[[Request], Awaitable[Reply]]


class FakeServer:
    def __init__(self, handler: Handler):
        self._handler = handler
        self._server: asyncio.Server | None = None
        self.requests: list[Request] = []
        self.client_gone = asyncio.Event()

    @property
    def url(self) -> str:
        assert self._server is not None
        port = self._server.sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}"

    async def __aenter__(self) -> "FakeServer":
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        return self

    async def __aexit__(self, *exc) -> None:
        assert self._server is not None
        self._server.close()
        await self._server.wait_closed()

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            lines = head.decode().split("\r\n")
            method, path, _ = lines[0].split(" ", 2)
            headers = {}
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()
            body = await reader.readexactly(int(headers.get("content-length", "0")))
            request = Request(method, path, headers, body)
            self.requests.append(request)
            reply = await self._handler(request)
            writer.write(
                f"HTTP/1.1 {reply.status} X\r\nconnection: close\r\n"
                "transfer-encoding: chunked\r\n".encode()
                + "".join(f"{k}: {v}\r\n" for k, v in reply.headers.items()).encode()
                + b"\r\n"
            )
            await writer.drain()
            for chunk in reply.chunks:
                if isinstance(chunk, float):
                    await asyncio.sleep(chunk)
                    continue
                writer.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                await writer.drain()
            if reply.hold_open:
                # EOF from the client means it closed the request.
                await reader.read()
                self.client_gone.set()
                return
            writer.write(b"0\r\n\r\n")
            await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            self.client_gone.set()
        finally:
            writer.close()
