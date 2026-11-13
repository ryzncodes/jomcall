"""`python -m jomcall_voice dev` runs the worker. It registers as `jomcall-voice`."""

from livekit.agents import cli

from .worker import build_options

if __name__ == "__main__":
    cli.run_app(build_options())
