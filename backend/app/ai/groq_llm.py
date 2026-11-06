"""Groq client for Graphiti, built for the free tier.

Differences from ``graphiti_core.llm_client.groq_client.GroqClient``:
- routes ``ModelSize.small`` prompts to ``small_model`` (upstream always uses
  ``model``), which also spreads load over two per-model quotas,
- waits on a persistent :class:`QuotaBudget` before each call and records the
  tokens Groq actually billed,
- on HTTP 429 it honours ``retry-after`` and retries itself. Upstream raises
  ``RateLimitError``, and Graphiti's tenacity wrapper gives up after 4 attempts,
  which is far too few for a daily quota,
- passes ``reasoning_effort`` for gpt-oss models (fewer hidden reasoning tokens).
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import typing

import groq
from graphiti_core.llm_client.client import LLMClient
from graphiti_core.llm_client.config import LLMConfig, ModelSize
from graphiti_core.prompts.models import Message
from groq import AsyncGroq
from pydantic import BaseModel, ValidationError

from .quota import QuotaBudget, estimate_tokens

logger = logging.getLogger(__name__)

MAX_429_RETRIES = 50
DEFAULT_RETRY_AFTER = 30.0
MAX_SCHEMA_ATTEMPTS = 3

SCHEMA_FEEDBACK = (
    'Output sebelumnya tidak valid: {error}\n'
    'Kembalikan satu objek JSON berisi NILAI yang sesuai skema (bukan skema itu sendiri). '
    'Gunakan null untuk nilai yang tidak diketahui.'
)


class SchemaOutputError(ValueError):
    """The model's output did not match the requested schema."""


def _declared_fields_only(data: typing.Any, model: type[BaseModel]) -> typing.Any:
    """Drop top-level keys the response model does not declare.

    gpt-oss often answers with the JSON schema it was shown *plus* the values
    (``{"title": "Course", "properties": {...}, "code": "ML"}``). Pydantic ignores
    the extras, but Graphiti stores every returned key as a node attribute, and
    Neo4j rejects map-valued properties.
    """
    if not isinstance(data, dict) or model.model_config.get('extra') == 'allow':
        return data
    allowed = set(model.model_fields)
    allowed |= {f.alias for f in model.model_fields.values() if f.alias}
    dropped = [k for k in data if k not in allowed]
    if dropped:
        logger.debug('Dropping undeclared keys from %s output: %s', model.__name__, dropped)
    return {k: v for k, v in data.items() if k in allowed}


def _schema_name(model: type[BaseModel]) -> str:
    return re.sub(r'[^a-zA-Z0-9_-]', '_', model.__name__)[:64] or 'response'


def _retry_after(err: groq.RateLimitError) -> float:
    headers = getattr(getattr(err, 'response', None), 'headers', None) or {}
    for key in ('retry-after', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests'):
        value = headers.get(key)
        if value:
            try:
                return float(value)
            except ValueError:
                # Groq reset headers look like "2m59.56s" / "7.66s"
                total, num = 0.0, ''
                for ch in value:
                    if ch.isdigit() or ch == '.':
                        num += ch
                    elif num:
                        total += float(num) * {'h': 3600, 'm': 60, 's': 1}.get(ch, 0)
                        num = ''
                if total:
                    return total
    return DEFAULT_RETRY_AFTER


class BudgetedGroqClient(LLMClient):
    def __init__(
        self,
        config: LLMConfig,
        budget: QuotaBudget,
        *,
        reasoning_effort: str | None = 'low',
        client: AsyncGroq | None = None,
    ) -> None:
        super().__init__(config, cache=False)
        self.budget = budget
        self.reasoning_effort = reasoning_effort or None
        self.client = client or AsyncGroq(api_key=config.api_key, max_retries=0)
        self._model_override: contextvars.ContextVar[str | None] = contextvars.ContextVar(
            'groq_model_override', default=None
        )
        # Models that rejected response_format=json_schema fall back to json_object.
        self._no_json_schema: set[str] = set()

    def _get_provider_type(self) -> str:
        return 'groq'

    def _pick_model(self, model: str | None, model_size: ModelSize) -> str:
        if override := self._model_override.get():
            return override
        if model:
            return model
        if model_size == ModelSize.small and self.small_model:
            return self.small_model
        assert self.model, 'LLMConfig.model is required'
        return self.model

    def use_model(self, model: str):
        client = self

        class ModelOverride:
            def __enter__(self):
                self.token = client._model_override.set(model)

            def __exit__(self, *_):
                client._model_override.reset(self.token)

        return ModelOverride()

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        max_tokens: int,
        temperature: float,
        json_mode: bool,
        schema: type[BaseModel] | None = None,
    ) -> tuple[str, int]:
        """One chat completion under the quota. Returns (content, billed tokens).

        With ``schema``, Groq's structured output (``json_schema``) constrains the
        reply; json_object mode alone lets models echo the schema back instead of
        filling it in. Groq answers 400 ``json_validate_failed`` when the output
        does not fit, which is raised as :class:`SchemaOutputError`.
        """
        prompt_tokens = sum(estimate_tokens(m['content']) for m in messages)
        reserve = prompt_tokens + min(max_tokens, 1500)
        base: dict[str, typing.Any] = {}
        if self.reasoning_effort and 'gpt-oss' in model:
            base['reasoning_effort'] = self.reasoning_effort

        attempt = 0
        while attempt < MAX_429_RETRIES:
            attempt += 1
            extra = dict(base)
            use_schema = schema is not None and model not in self._no_json_schema
            if use_schema:
                assert schema is not None
                extra['response_format'] = {
                    'type': 'json_schema',
                    'json_schema': {
                        'name': _schema_name(schema),
                        'schema': schema.model_json_schema(),
                        'strict': False,
                    },
                }
            elif json_mode:
                extra['response_format'] = {'type': 'json_object'}
            reservation = await self.budget.acquire(model, reserve)
            try:
                response = await self.client.chat.completions.create(
                    model=model,
                    messages=typing.cast(typing.Any, messages),
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **extra,
                )
            except groq.RateLimitError as e:
                wait = _retry_after(e)
                self.budget.block(model, wait)
                logger.warning('Groq 429 on %s (attempt %d), retry in %.0fs', model, attempt, wait)
                continue
            except groq.BadRequestError as e:
                msg = str(e)
                if 'json_validate_failed' in msg:
                    raise SchemaOutputError(msg[:500]) from e
                if use_schema and ('json_schema' in msg or 'response_format' in msg):
                    logger.warning('%s rejected json_schema, falling back to json_object: %s', model, msg[:200])
                    self._no_json_schema.add(model)
                    attempt -= 1
                    continue
                raise
            usage = getattr(response, 'usage', None)
            billed = getattr(usage, 'total_tokens', None) or reserve
            self.budget.settle(reservation, billed)
            return response.choices[0].message.content or '', billed
        raise RuntimeError(f'Groq kept rate limiting {model} after {MAX_429_RETRIES} attempts')

    async def _generate_response(
        self,
        messages: list[Message],
        response_model: type[BaseModel] | None = None,
        max_tokens: int = 4096,
        model_size: ModelSize = ModelSize.medium,
        *,
        model: str | None = None,
    ) -> dict[str, typing.Any]:
        chosen = self._pick_model(model, model_size)
        msgs = [
            {'role': m.role if m.role in ('system', 'user', 'assistant') else 'user', 'content': m.content}
            for m in messages
        ]
        last_error: Exception | None = None
        for _ in range(MAX_SCHEMA_ATTEMPTS):
            content = ''
            try:
                content, _ = await self.complete(
                    msgs,
                    model=chosen,
                    max_tokens=max_tokens or self.max_tokens,
                    temperature=self.temperature,
                    json_mode=True,
                    schema=response_model,
                )
                data = json.loads(content)
                if response_model is not None:
                    response_model.model_validate(data)
                    data = _declared_fields_only(data, response_model)
                return data
            except (SchemaOutputError, json.JSONDecodeError, ValidationError) as e:
                last_error = e
                logger.warning('Invalid structured output from %s: %s', chosen, str(e)[:300])
                if content:
                    msgs = [*msgs, {'role': 'assistant', 'content': content}]
                msgs = [*msgs, {'role': 'user', 'content': SCHEMA_FEEDBACK.format(error=str(e)[:500])}]
        assert last_error is not None
        raise last_error
