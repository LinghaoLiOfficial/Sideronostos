"""A real embedding provider with explicit model identity and safe errors."""

import hashlib
import math
from typing import Any

from openai import AsyncOpenAI

from ...core.config import AppEnvironment, configured_environment
from ..ai.settings import get_ai_settings
from .mock_release import MOCK_MODEL, mock_embedding
from .settings import KnowledgeSettings, get_knowledge_settings


class EmbeddingUnavailable(RuntimeError):
    pass


def validate_vector(value: Any, dimensions: int) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != dimensions:
        raise ValueError("Embedding dimension mismatch")
    if any(
        isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v)
        for v in value
    ):
        raise ValueError("Embedding must contain finite numbers")
    if sum(float(v) ** 2 for v in value) == 0:
        raise ValueError("Zero embeddings have no cosine direction")
    return [float(v) for v in value]


class EmbeddingProvider:
    def __init__(self, settings: KnowledgeSettings | None = None) -> None:
        self.settings = settings or get_knowledge_settings()
        ai = get_ai_settings()
        key = self.settings.api_key.get_secret_value() or ai.api_key.get_secret_value()
        local = configured_environment() == AppEnvironment.LOCAL
        self.mock_embeddings = self.settings.embedding_mode == "mock" or (
            self.settings.embedding_mode == "auto" and local and not key
        )
        if self.settings.embedding_mode == "mock" and not local:
            raise RuntimeError("Mock embeddings are available only in the local environment")
        self.model_name = MOCK_MODEL if self.mock_embeddings else self.settings.embedding_model
        self.base_url = (
            "local://mock" if self.mock_embeddings else self.settings.base_url or ai.base_url
        )
        self.namespace = hashlib.sha256(
            f"{self.base_url}|{self.model_name}|{self.settings.embedding_dimensions}".encode()
        ).hexdigest()[:24]
        self.client = AsyncOpenAI(
            api_key=key or "not-configured",
            base_url=self.base_url,
            timeout=self.settings.request_timeout_seconds,
            max_retries=0,
        )
        self.configured = bool(key) or self.mock_embeddings

    async def close(self) -> None:
        await self.client.close()

    async def embed(self, texts: list[str]) -> tuple[list[list[float]], int]:
        if self.mock_embeddings:
            if (
                not texts
                or len(texts) > self.settings.batch_size
                or any(not t.strip() or len(t) > 5000 for t in texts)
            ):
                raise ValueError("Embedding batch is empty or exceeds its input budget")
            return (
                [mock_embedding(text, self.settings.embedding_dimensions) for text in texts],
                0,
            )
        if not self.configured:
            raise EmbeddingUnavailable("Embedding credentials are not configured")
        if (
            not texts
            or len(texts) > self.settings.batch_size
            or any(not t.strip() or len(t) > 5000 for t in texts)
        ):
            raise ValueError("Embedding batch is empty or exceeds its input budget")
        try:
            response = await self.client.embeddings.create(
                input=texts,
                model=self.settings.embedding_model,
                dimensions=self.settings.embedding_dimensions,
            )
            ordered = sorted(response.data, key=lambda item: item.index)
            if [item.index for item in ordered] != list(range(len(texts))):
                raise ValueError("Embedding response does not match the batch")
            vectors = [
                validate_vector(item.embedding, self.settings.embedding_dimensions)
                for item in ordered
            ]
            return vectors, response.usage.total_tokens
        except Exception as error:
            # Provider errors may repeat part of a credential; never propagate their text.
            raise EmbeddingUnavailable(
                f"Embedding request failed ({type(error).__name__})"
            ) from None
