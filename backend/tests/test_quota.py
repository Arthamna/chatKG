import json

from app.ai.groq_llm import _retry_after
from app.ai.quota import DAY, MINUTE, Limits, QuotaBudget


class FakeClock:
    def __init__(self, t: float = 1_000_000.0) -> None:
        self.t = t
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.t

    async def sleep(self, s: float) -> None:
        self.slept.append(s)
        self.t += s


def make(limits: Limits, tmp_path=None, clock=None):
    clock = clock or FakeClock()
    waits = []
    b = QuotaBudget(
        limits,
        tmp_path / 'q.json' if tmp_path else None,
        clock=clock,
        sleep=clock.sleep,
        on_wait=lambda m, s, r: waits.append((m, round(s), r)),
    )
    return b, clock, waits


async def test_requests_per_minute_waits_for_window():
    b, clock, waits = make(Limits(rpm=2))
    await b.acquire('m', 10)
    await b.acquire('m', 10)
    assert not clock.slept
    await b.acquire('m', 10)
    assert waits[0] == ('m', 60, 'requests/minute')
    assert sum(clock.slept) >= MINUTE


async def test_tokens_per_day_waits_until_next_day():
    b, clock, waits = make(Limits(tpd=1000))
    start = clock.t
    r = await b.acquire('m', 900)
    b.settle(r, 950)
    await b.acquire('m', 100)  # 950 + 100 > 1000 -> wait for the first one to expire
    assert waits[0][2] == 'tokens/day'
    assert clock.t - start >= DAY


async def test_models_have_separate_budgets():
    b, clock, _ = make(Limits(rpd=1))
    await b.acquire('big', 1)
    await b.acquire('small', 1)
    assert not clock.slept


async def test_oversized_request_runs_when_window_empty():
    b, clock, _ = make(Limits(tpm=100))
    await b.acquire('m', 500)
    assert not clock.slept


async def test_block_after_429_and_persistence(tmp_path):
    b, clock, _ = make(Limits(rpm=30), tmp_path)
    r = await b.acquire('m', 10)
    b.settle(r, 42)
    b.block('m', 20)
    state = json.loads((tmp_path / 'q.json').read_text())
    assert state['events']['m'][0][1] == 42.0 and state['blocked']['m'] > clock.t

    # a new process sees the same usage and block
    b2, _, waits2 = make(Limits(rpm=30), tmp_path, clock)
    assert b2.usage('m')['tokens_day'] == 42
    await b2.acquire('m', 10)
    assert waits2[0][2] == 'rate limited (429)'


def test_scaled_limits_keep_zero_unlimited():
    assert Limits(rpm=30, tpm=0, rpd=1000, tpd=200000).scaled(0.9) == Limits(27, 0, 900, 180000)


def test_retry_after_parsing():
    class Resp:
        def __init__(self, h):
            self.headers = h

    class Err:
        def __init__(self, h):
            self.response = Resp(h)

    assert _retry_after(Err({'retry-after': '12'})) == 12
    assert _retry_after(Err({'x-ratelimit-reset-tokens': '2m59.5s'})) == 179.5
    assert _retry_after(Err({})) == 30.0
