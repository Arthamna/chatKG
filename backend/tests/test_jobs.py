import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.ai.openrouter_llm import IncompleteCompletion
from app.config import get_settings
from app.jobs import JobRunner


async def test_incomplete_ingest_is_requeued_from_persistent_job_checkpoint():
    settings = get_settings().model_copy(
        update={'ingest_incomplete_retries': 3, 'ingest_retry_base_seconds': 0}
    )
    runner = JobRunner(SimpleNamespace(driver=None), settings)
    runner.get = AsyncMock(
        return_value={'id': 'job-1', 'kind': 'ingest', 'status': 'retrying', 'batch_retry_attempt': 1}
    )
    runner._update = AsyncMock()
    runner._log = AsyncMock()

    retried = await runner._retry_incomplete_job('job-1', IncompleteCompletion('finish_reason=length'))
    await asyncio.gather(*list(runner._retry_tasks))

    assert retried is True
    runner._update.assert_awaited_once()
    fields = runner._update.await_args.kwargs
    assert fields['status'] == 'retrying'
    assert fields['batch_retry_attempt'] == 2
    assert fields['retry_attempt'] == 2
    assert fields['retry_max'] == 3
    assert runner.queue.get_nowait() == 'job-1'


async def test_incomplete_ingest_stops_after_outer_retry_limit():
    settings = get_settings().model_copy(update={'ingest_incomplete_retries': 2})
    runner = JobRunner(SimpleNamespace(driver=None), settings)
    runner.get = AsyncMock(
        return_value={'id': 'job-1', 'kind': 'ingest', 'status': 'running', 'batch_retry_attempt': 2}
    )
    runner._update = AsyncMock()
    runner._log = AsyncMock()

    retried = await runner._retry_incomplete_job('job-1', IncompleteCompletion('finish_reason=length'))

    assert retried is False
    runner._update.assert_not_awaited()
    assert runner.queue.empty()


async def test_non_ingest_incomplete_job_is_not_requeued():
    runner = JobRunner(SimpleNamespace(driver=None), get_settings())
    runner.get = AsyncMock(return_value={'id': 'job-1', 'kind': 'schema', 'status': 'running'})
    runner._update = AsyncMock()

    assert await runner._retry_incomplete_job('job-1', IncompleteCompletion('empty')) is False
    runner._update.assert_not_awaited()
