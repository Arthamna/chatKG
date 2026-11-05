"""Chat -> KG backend.

Importing ``app.config`` here guarantees ``EMBEDDING_DIM`` is in the environment
before any ``app.*`` module imports ``graphiti_core`` (which reads it at import time).
"""

from app import config as _config  # noqa: F401
