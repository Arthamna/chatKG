from types import SimpleNamespace

import groq
import httpx
from graphiti_core.llm_client.config import LLMConfig, ModelSize
from graphiti_core.prompts.models import Message
from pydantic import BaseModel

from app.ai.groq_llm import BudgetedGroqClient
from app.ai.quota import Limits, QuotaBudget


class FakeCompletions:
    def __init__(self, fail_first: int = 0, contents: list[str] | None = None) -> None:
        self.calls: list[dict] = []
        self.fail_first = fail_first
        self.contents = list(contents or [])

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) <= self.fail_first:
            req = httpx.Request('POST', 'https://api.groq.com/openai/v1/chat/completions')
            resp = httpx.Response(429, request=req, headers={'retry-after': '7'})
            raise groq.RateLimitError('rate limited', response=resp, body=None)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=self.contents.pop(0) if self.contents else '{"ok": true}')
                )
            ],
            usage=SimpleNamespace(total_tokens=123),
        )


def make_client(fail_first=0, contents=None):
    slept: list[float] = []
    now = [0.0]

    async def sleep(s):
        slept.append(s)
        now[0] += s

    budget = QuotaBudget(Limits(rpm=30), clock=lambda: now[0], sleep=sleep)
    completions = FakeCompletions(fail_first, contents)
    fake = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    client = BudgetedGroqClient(
        LLMConfig(api_key='x', model='openai/gpt-oss-120b', small_model='openai/gpt-oss-20b', temperature=0),
        budget,
        client=fake,  # type: ignore[arg-type]
    )
    return client, completions, budget, slept


async def test_routes_small_prompts_and_settles_usage():
    client, completions, budget, _ = make_client()
    msgs = [Message(role='system', content='s'), Message(role='user', content='u')]
    out = await client.generate_response(msgs, model_size=ModelSize.small)
    assert out == {'ok': True}
    call = completions.calls[0]
    assert call['model'] == 'openai/gpt-oss-20b'
    assert call['response_format'] == {'type': 'json_object'}
    assert call['reasoning_effort'] == 'low'
    assert budget.usage('openai/gpt-oss-20b')['tokens_day'] == 123

    await client.generate_response([Message(role='system', content='s'), Message(role='user', content='u')])
    assert completions.calls[1]['model'] == 'openai/gpt-oss-120b'


async def test_429_waits_retry_after_then_succeeds():
    client, completions, _, slept = make_client(fail_first=2)
    text, billed = await client.complete(
        [{'role': 'user', 'content': 'hi'}], model='openai/gpt-oss-20b', max_tokens=50, temperature=0, json_mode=True
    )
    assert text == '{"ok": true}' and billed == 123
    assert len(completions.calls) == 3
    assert sum(slept) >= 14  # two retry-after waits of 7s


class CourseAttrs(BaseModel):
    code: str | None = None
    full_name: str | None = None


async def test_schema_echo_is_rejected_and_retried():
    echoed = '{"code": {"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Code"}, "full_name": null}'
    good = '{"code": "ML", "full_name": "Machine Learning"}'
    client, completions, _, _ = make_client(contents=[echoed, good])
    out = await client.generate_response(
        [Message(role='system', content='s'), Message(role='user', content='u')], response_model=CourseAttrs
    )
    assert out == {'code': 'ML', 'full_name': 'Machine Learning'}
    first = completions.calls[0]['response_format']
    assert first['type'] == 'json_schema' and first['json_schema']['name'] == 'CourseAttrs'
    retry_msgs = completions.calls[1]['messages']
    assert retry_msgs[-2] == {'role': 'assistant', 'content': echoed}
    assert 'bukan skema' in retry_msgs[-1]['content']


async def test_schema_plus_values_keeps_only_declared_fields():
    mixed = (
        '{"description": "Mata kuliah.", "properties": {"code": {"title": "Code"}}, "title": "Course",'
        ' "type": "object", "code": "ML", "full_name": "Machine Learning"}'
    )
    client, completions, _, _ = make_client(contents=[mixed])
    out = await client.generate_response(
        [Message(role='system', content='s'), Message(role='user', content='u')], response_model=CourseAttrs
    )
    assert out == {'code': 'ML', 'full_name': 'Machine Learning'}
    assert len(completions.calls) == 1
