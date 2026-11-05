"""Request/token budget for Groq's per-model rate limits (RPM, TPM, RPD, TPD).

The free tier allows roughly 1k requests and 200k tokens per day per model, and
Graphiti makes several calls per episode. Instead of failing, ``acquire`` waits
until the sliding window has room again, which can mean waiting until the next
day. Usage is persisted to a JSON file so a restarted worker keeps counting.

One process should own a state file. The API and worker will share it through
Redis later (design/backend-pipeline.md §4.4).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

MINUTE = 60.0
DAY = 86400.0
MAX_SLEEP_CHUNK = 300.0  # re-check at least every 5 minutes

WaitCallback = Callable[[str, float, str], None]


@dataclass(frozen=True)
class Limits:
    rpm: int = 0
    tpm: int = 0
    rpd: int = 0
    tpd: int = 0

    def scaled(self, ratio: float) -> Limits:
        def f(x: int) -> int:
            return max(1, int(x * ratio)) if x else 0

        return Limits(f(self.rpm), f(self.tpm), f(self.rpd), f(self.tpd))


class QuotaBudget:
    def __init__(
        self,
        limits: Limits,
        state_path: Path | None = None,
        *,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        on_wait: WaitCallback | None = None,
    ) -> None:
        self.limits = limits
        self.state_path = state_path
        self._clock = clock
        self._sleep = sleep
        self.on_wait = on_wait
        self._lock = asyncio.Lock()
        # model -> list of [timestamp, tokens]; model -> unix time until which it is blocked
        self._events: dict[str, list[list[float]]] = {}
        self._blocked: dict[str, float] = {}
        self._load()

    # ---- persistence ----
    def _load(self) -> None:
        if not (self.state_path and self.state_path.exists()):
            return
        try:
            data = json.loads(self.state_path.read_text())
            self._events = {k: [list(e) for e in v] for k, v in data.get('events', {}).items()}
            self._blocked = {k: float(v) for k, v in data.get('blocked', {}).items()}
        except (ValueError, OSError, AttributeError):
            logger.warning('Ignoring unreadable quota state %s', self.state_path)

    def _save(self) -> None:
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix('.tmp')
        tmp.write_text(json.dumps({'events': self._events, 'blocked': self._blocked}))
        tmp.replace(self.state_path)

    # ---- window math ----
    def _prune(self, model: str, now: float) -> list[list[float]]:
        events = [e for e in self._events.get(model, []) if e[0] > now - DAY]
        self._events[model] = events
        return events

    @staticmethod
    def _count_wait(events: list[list[float]], window: float, limit: int, now: float) -> float:
        if not limit:
            return 0.0
        inside = [e for e in events if e[0] > now - window]
        if len(inside) < limit:
            return 0.0
        # The (len - limit + 1)-th oldest must expire before one more fits.
        return inside[len(inside) - limit][0] + window - now

    @staticmethod
    def _token_wait(events: list[list[float]], window: float, limit: int, need: int, now: float) -> float:
        if not limit:
            return 0.0
        inside = [e for e in events if e[0] > now - window]
        used = sum(e[1] for e in inside)
        # A single request larger than the window limit runs once the window is empty.
        need = min(need, limit)
        if used + need <= limit:
            return 0.0
        for ts, tokens in inside:
            used -= tokens
            if used + need <= limit:
                return ts + window - now
        return inside[-1][0] + window - now

    def wait_time(self, model: str, tokens: int) -> tuple[float, str]:
        now = self._clock()
        events = self._prune(model, now)
        lim = self.limits
        waits = {
            'rate limited (429)': self._blocked.get(model, 0.0) - now,
            'requests/minute': self._count_wait(events, MINUTE, lim.rpm, now),
            'tokens/minute': self._token_wait(events, MINUTE, lim.tpm, tokens, now),
            'requests/day': self._count_wait(events, DAY, lim.rpd, now),
            'tokens/day': self._token_wait(events, DAY, lim.tpd, tokens, now),
        }
        reason = max(waits, key=lambda k: waits[k])
        return max(0.0, waits[reason]), reason

    # ---- public API ----
    async def acquire(self, model: str, tokens: int) -> list[float]:
        """Reserve ``tokens`` for one request; returns the reservation for ``settle``."""
        async with self._lock:
            while True:
                wait, reason = self.wait_time(model, tokens)
                if wait <= 0:
                    event = [self._clock(), float(tokens)]
                    self._events.setdefault(model, []).append(event)
                    self._save()
                    return event
                if self.on_wait:
                    self.on_wait(model, wait, reason)
                logger.info('LLM quota (%s) for %s: waiting %.0fs', reason, model, wait)
                await self._sleep(min(wait, MAX_SLEEP_CHUNK) + 0.05)

    def settle(self, reservation: list[float], actual_tokens: int) -> None:
        """Replace the reserved estimate with the tokens Groq actually billed."""
        reservation[1] = float(actual_tokens)
        self._save()

    def block(self, model: str, seconds: float) -> None:
        """After a 429, stop sending to ``model`` for ``seconds`` (Groq's retry-after)."""
        until = self._clock() + max(1.0, seconds)
        self._blocked[model] = max(self._blocked.get(model, 0.0), until)
        self._save()

    def usage(self, model: str) -> dict[str, float]:
        now = self._clock()
        events = self._prune(model, now)
        minute = [e for e in events if e[0] > now - MINUTE]
        return {
            'requests_day': len(events),
            'tokens_day': sum(e[1] for e in events),
            'requests_minute': len(minute),
            'tokens_minute': sum(e[1] for e in minute),
        }


def estimate_tokens(text: str) -> int:
    """Rough token count for budgeting (≈3 chars/token for Indonesian + JSON)."""
    return max(1, len(text) // 3)
