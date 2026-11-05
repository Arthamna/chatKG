import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import openai
import pytest
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.prompts.models import Message
from pydantic import BaseModel

from app.ai.openrouter_llm import OpenRouterClient, free_model
from app.ai.quota import Limits, QuotaBudget


def response(content='{"ok": true}', finish='stop'):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish)],
        usage=SimpleNamespace(total_tokens=10),
    )


def make_client(replies, **limits):
    now = [0.0]
    waits = []

    async def sleep(seconds):
        waits.append(seconds)
        now[0] += seconds

    budget = QuotaBudget(Limits(**limits), clock=lambda: now[0], sleep=sleep)
    completions = SimpleNamespace(create=AsyncMock(side_effect=replies))
    client = OpenRouterClient(
        LLMConfig(api_key='test', model='openrouter/free', temperature=0),
        budget,
        client=SimpleNamespace(chat=SimpleNamespace(completions=completions)),
    )
    return client, completions, waits


class Output(BaseModel):
    ok: bool


async def test_structured_output_retries_invalid_json_and_never_uses_paid_models():
    client, completions, _ = make_client([response('bad'), response()])
    result = await client.generate_response([Message(role='user', content='test')], response_model=Output)
    assert result == {'ok': True}
    call = completions.create.call_args.kwargs
    assert call['response_format']['type'] == 'json_schema'
    assert call['extra_body']['provider']['require_parameters'] is True
    assert call['model'] == 'openrouter/free'
    with pytest.raises(ValueError, match='hanya mengizinkan'):
        await client.complete([], model='paid/model', max_tokens=100, temperature=0, json_mode=True)
    assert completions.create.await_count == 2


@pytest.mark.parametrize('model', ['openrouter/auto', 'openai/gpt-4o', ''])
def test_paid_models_rejected(model):
    with pytest.raises(ValueError):
        free_model(model)


async def test_free_models_share_a_single_request_budget():
    client, _, waits = make_client([response(), response()], rpm=1)
    for model in ('openrouter/free', 'vendor/model:free'):
        await client.complete([], model=model, max_tokens=100, temperature=0, json_mode=False)
    assert sum(waits) >= 60
    assert client.budget.usage(client.quota_key)['requests_day'] == 2


@pytest.mark.parametrize('status', [429, 503])
async def test_retry_after_and_failed_requests_count_towards_quota(status):
    request = httpx.Request('POST', 'https://openrouter.ai/api/v1/chat/completions')
    error = openai.APIStatusError(
        'wait', response=httpx.Response(status, request=request, headers={'retry-after': '7'}), body={}
    )
    client, _, waits = make_client([error, response()])
    text, _ = await client.complete([], model='openrouter/free', max_tokens=100, temperature=0, json_mode=True)
    assert json.loads(text) == {'ok': True} and sum(waits) >= 7
    assert client.budget.usage(client.quota_key)['requests_day'] == 2


async def test_truncation_reports_effective_limit_and_provider_usage():
    truncated = response('{}', finish='length')
    truncated.model = 'vendor/model:free'
    truncated.usage.completion_tokens = 100
    truncated.usage.completion_tokens_details = SimpleNamespace(reasoning_tokens=95)
    client, calls, _ = make_client([truncated])
    with pytest.raises(ValueError, match=r'terpotong.*model=vendor/model:free.*max_tokens=100.*reasoning_tokens=95'):
        await client.complete([], model='openrouter/free', max_tokens=100, temperature=0, json_mode=True)
    assert calls.create.await_count == 1


@pytest.mark.parametrize(
    'incomplete',
    [
        response('', finish='length'),
        response('  '),
        SimpleNamespace(choices=[], usage=None),
    ],
)
async def test_structured_output_recovers_from_incomplete_response(incomplete):
    client, calls, _ = make_client([incomplete, response()])
    client.max_tokens = 8192

    result = await client.generate_response([Message(role='user', content='test')], response_model=Output)

    assert result == {'ok': True}
    assert [call.kwargs['max_tokens'] for call in calls.create.await_args_list] == [8192, 8192]
    assert 'lengkap dan ringkas' in calls.create.call_args.kwargs['messages'][-1]['content']
    assert client.budget.usage(client.quota_key)['requests_day'] == 2


async def test_auth_failure_stops_without_retry():
    request = httpx.Request('POST', 'https://openrouter.ai/api/v1/chat/completions')
    error = openai.APIStatusError('auth', response=httpx.Response(401, request=request), body={})
    client, calls, _ = make_client([error])
    with pytest.raises(openai.APIStatusError):
        await client.complete([], model='openrouter/free', max_tokens=100, temperature=0, json_mode=True)
    assert calls.create.await_count == 1
