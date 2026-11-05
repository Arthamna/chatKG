INFO:     127.0.0.1:59857 - "GET /api/ingest-jobs/68881bee3e4d HTTP/1.1" 200 OK
INFO:     127.0.0.1:51729 - "GET /api/ingest-jobs/68881bee3e4d HTTP/1.1" 200 OK
ingest job 68881bee3e4d failed
Traceback (most recent call last):
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\app\jobs.py", line 228, in _worker
    await self._run_task
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\app\jobs.py", line 269, in _run
    await self._discover(job, src, prepared)
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\app\jobs.py", line 402, in _discover
    ontology, sampled = await discover_schema(self.llm, prepared, baseline)
                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\app\ai\discovery.py", line 59, in discover_schema
    result = await llm.generate_response(messages, response_model=Ontology)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\graphiti_core\llm_client\client.py", line 266, in generate_response
    response = await self._generate_response_with_retry(
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\tenacity\asyncio\__init__.py", line 232, in async_wrapped
    return await copy(fn, *args, **kwargs)  # type: ignore[type-var]
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\tenacity\asyncio\__init__.py", line 126, in __call__
    do = await self.iter(retry_state=retry_state)
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\tenacity\asyncio\__init__.py", line 171, in iter    
    result = await action(retry_state)
             ^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\tenacity\_utils.py", line 130, in inner
    return call(*args, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\tenacity\__init__.py", line 462, in <lambda>        
    self._add_action_func(lambda rs: rs.outcome.result())
                                     ^^^^^^^^^^^^^^^^^^^
  File "C:\5\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\Lib\concurrent\futures\_base.py", line 449, in result
    return self.__get_result()
           ^^^^^^^^^^^^^^^^^^^
  File "C:\5\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\Lib\concurrent\futures\_base.py", line 401, in __get_result
    raise self._exception
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\tenacity\asyncio\__init__.py", line 130, in __call__
    result = await fn(*args, **kwargs)
             ^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\.venv\Lib\site-packages\graphiti_core\llm_client\client.py", line 146, in _generate_response_with_retry
    return await self._generate_response(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\app\ai\openrouter_llm.py", line 108, in _generate_response
    content, _ = await self.complete(
                 ^^^^^^^^^^^^^^^^^^^^
  File "C:\5\Saveable\Project\Fullstack\lwa\lwa--graph-visualizer\backend\app\ai\openrouter_llm.py", line 93, in complete
    raise ValueError('Respons LLM kosong atau terpotong; kurangi ukuran episode atau naikkan batas output')
ValueError: Respons LLM kosong atau terpotong; kurangi ukuran episode atau naikkan batas output