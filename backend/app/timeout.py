"""Run a slow call (a Gemini request) with a hard time limit."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

T = TypeVar("T")


def call_with_timeout(fn: Callable[..., T], timeout_s: float, *args) -> T:
    """fn(*args), or raise if it errors or takes longer than `timeout_s` seconds. The call
    is left to finish in the background; the caller doesn't wait for it."""
    # Not a `with` block: its exit waits for the thread, which defeats the timeout.
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        return pool.submit(fn, *args).result(timeout=timeout_s)
    finally:
        pool.shutdown(wait=False)
