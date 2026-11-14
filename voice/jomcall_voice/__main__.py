"""`python -m jomcall_voice dev` runs the worker. It registers as `jomcall-voice`."""

from livekit.agents import cli

from . import config
from .worker import build_options

if __name__ == "__main__":
    # A wrong turn URL or a missing service secret stops the worker here, so
    # it never registers and then fails every call.
    config.startup_check()
    cli.run_app(build_options())
