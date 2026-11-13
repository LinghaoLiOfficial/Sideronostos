from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr

from ...core.config import EnvironmentSettings


class KnowledgeSettings(EnvironmentSettings):
    model_config = EnvironmentSettings.model_config | {"env_prefix": "KNOWLEDGE_"}
    library_root: Path | None = None
    asset_root: Path = Path("../data/knowledge")
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = Field(default=1536, ge=1, le=3072)
    api_key: SecretStr = SecretStr("")
    base_url: str | None = None
    request_timeout_seconds: float = Field(default=12, gt=0, le=30)
    batch_size: int = Field(default=24, ge=1, le=64)
    retrieval_candidates: int = Field(default=40, ge=8, le=200)


@lru_cache
def get_knowledge_settings() -> KnowledgeSettings:
    return KnowledgeSettings()
