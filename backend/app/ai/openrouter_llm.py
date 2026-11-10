from __future__ import annotations

import asyncio
import contextvars
import json
import logging
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import openai
from graphiti_core.llm_client.client import LLMClient
from graphiti_core.llm_client.config import LLMConfig, ModelSize
from openai import AsyncOpenAI
from pydantic import ValidationError

from .groq_llm import _declared_fields_only
from .quota import QuotaBudget, estimate_tokens

logger = logging.getLogger(__name__)


class IncompleteCompletion(ValueError):
    pass


def free_model(model: str) -> str:
    if model != 'openrouter/free' and not model.endswith(':free'):
        raise ValueError('OpenRouter hanya mengizinkan openrouter/free atau model dengan akhiran :free')
    return model


def retry_seconds(value: str | None, fallback: float) -> float:
    if value:
        try:
            return max(1.0, float(value))
        except ValueError:
            try:
                return max(1.0, (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds())
            except (ValueError, TypeError):
                pass
    return fallback


class OpenRouterClient(LLMClient):
    quota_key = 'openrouter:free'

    def __init__(
        self,
        config: LLMConfig,
        budget: QuotaBudget,
        *,
        client=None,
        incomplete_retries: int = 3,
        sleep=asyncio.sleep,
    ):
        free_model(config.model or '')
        super().__init__(config, cache=False)
        self.budget = budget
        self.incomplete_retries = max(0, incomplete_retries)
        self.retry_sleep = sleep
        self.on_retry = None
        self._model_override: contextvars.ContextVar[str | None] = contextvars.ContextVar(
            'openrouter_model_override', default=None
        )
        self._retry_callback: contextvars.ContextVar = contextvars.ContextVar('openrouter_retry_callback', default=None)
        self.client = client or AsyncOpenAI(
            api_key=config.api_key,
            base_url='https://openrouter.ai/api/v1',
            max_retries=0,
            timeout=120,
        )

    def _get_provider_type(self):
        return 'openrouter'

    def use_model(self, model: str):
        free_model(model)
        client = self

        class ModelOverride:
            def __enter__(self):
                self.token = client._model_override.set(model)

            def __exit__(self, *_):
                client._model_override.reset(self.token)

        return ModelOverride()

    def use_retry_callback(self, callback):
        client = self

        class RetryCallback:
            def __enter__(self):
                self.token = client._retry_callback.set(callback)

            def __exit__(self, *_):
                client._retry_callback.reset(self.token)

        return RetryCallback()

    async def complete(self, messages, *, model, max_tokens, temperature, json_mode, schema=None):
        model = free_model(model)
        reserve = sum(estimate_tokens(m['content']) for m in messages) + max_tokens
        for attempt in range(8):
            reservation = await self.budget.acquire(self.quota_key, reserve)
            extra = {'provider': {'require_parameters': True}}
            response_format = None
            if schema:
                response_format = {
                    'type': 'json_schema',
                    'json_schema': {'name': schema.__name__[:64], 'schema': schema.model_json_schema()},
                }
            elif json_mode:
                response_format = {'type': 'json_object'}
            kwargs = {'response_format': response_format} if response_format else {}
            try:
                response = await self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    extra_body=extra,
                    **kwargs,
                )
            except openai.APIStatusError as e:
                if e.status_code in (429, 503) and attempt < 7:
                    delay = retry_seconds(e.response.headers.get('retry-after'), min(60, 2 ** (attempt + 1)))
                    self.budget.block(self.quota_key, delay)
                    continue
                raise
            except openai.APIConnectionError:
                if attempt == 7:
                    raise
                await asyncio.sleep(min(60, 2 ** (attempt + 1)))
                continue
            usage = getattr(response, 'usage', None)
            billed = getattr(usage, 'total_tokens', None) or reserve
            self.budget.settle(reservation, billed)
            choice = response.choices[0] if response.choices else None
            finish = choice.finish_reason if choice else 'no_choices'
            content = (choice.message.content or '') if choice else ''
            if not choice or finish == 'length' or ((schema or json_mode) and not content.strip()):
                details = getattr(usage, 'completion_tokens_details', None)
                reason = 'terpotong' if finish == 'length' else 'kosong'
                raise IncompleteCompletion(
                    f'Respons OpenRouter {reason} (model={getattr(response, "model", None) or model}, '
                    f'generation_id={getattr(response, "id", None)}, finish_reason={finish}, '
                    f'native_finish_reason={getattr(choice, "native_finish_reason", None)}, '
                    f'max_tokens={max_tokens}, completion_tokens={getattr(usage, "completion_tokens", None)}, '
                    f'reasoning_tokens={getattr(details, "reasoning_tokens", None)}).'
                )
            return content, billed
        raise RuntimeError('OpenRouter tidak tersedia setelah beberapa percobaan')

    async def _generate_response(
        self,
        messages,
        response_model=None,
        max_tokens=4096,
        model_size=ModelSize.medium,
        *,
        model=None,
    ):
        msgs = [{'role': m.role, 'content': m.content} for m in messages]
        compact_output = {
            'role': 'user',
            'content': 'Kembalikan langsung satu objek JSON yang lengkap dan ringkas. '
            'Gunakan deskripsi pendek dan pertahankan semua entri wajib.',
        }
        incomplete_attempt = 0
        schema_attempt = 0
        while True:
            try:
                content, _ = await self.complete(
                    msgs,
                    model=self._model_override.get() or model or self.model,
                    max_tokens=max_tokens,
                    temperature=self.temperature,
                    json_mode=True,
                    schema=response_model,
                )
            except IncompleteCompletion as e:
                if incomplete_attempt >= self.incomplete_retries:
                    raise
                incomplete_attempt += 1
                delay = 2 ** (incomplete_attempt - 1)
                logger.warning('%s Mencoba lagi dengan instruksi output ringkas.', e)
                if compact_output not in msgs:
                    msgs.append(compact_output)
                callback = self._retry_callback.get() or self.on_retry
                if callback:
                    callback(incomplete_attempt, self.incomplete_retries, str(e), delay)
                await self.retry_sleep(delay)
                continue
            try:
                data = json.loads(content)
                if not isinstance(data, dict):
                    raise TypeError('Respons harus berupa objek JSON')
                if response_model:
                    response_model.model_validate(data)
                    data = _declared_fields_only(data, response_model)
                return data
            except (TypeError, ValueError, ValidationError) as e:
                schema_attempt += 1
                if schema_attempt >= 3:
                    raise
                msgs.append({'role': 'user', 'content': f'Perbaiki JSON sesuai skema respons: {str(e)[:500]}'})
