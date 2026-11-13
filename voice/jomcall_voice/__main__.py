"""`python -m jomcall_voice dev` runs the worker. It registers as `jomcall-voice`."""

from livekit.agents import WorkerOptions, cli

from . import config
from .worker import entrypoint

if __name__ == "__main__":
    # agent_name turns on explicit dispatch: jobs come only from the dispatch the
    # JomCall API creates. LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET
    # are read from the environment by the library.
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=config.AGENT_NAME))
