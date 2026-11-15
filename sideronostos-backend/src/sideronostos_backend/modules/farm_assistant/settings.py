from functools import lru_cache

from pydantic import Field

from ...core.config import EnvironmentSettings


class AssistantSettings(EnvironmentSettings):
    model_config = EnvironmentSettings.model_config | {"env_prefix": "ASSISTANT_"}
    deadline_seconds: float = Field(default=45, ge=10, le=90)
    history_messages: int = Field(default=6, ge=0, le=12)
    retrieval_limit: int = Field(default=8, ge=4, le=8)
    result_frontend_origin: str = "http://127.0.0.1:4174"
    result_api_origin: str = "http://127.0.0.1:8009"
    result_browser_channel: str | None = None


@lru_cache
def get_assistant_settings() -> AssistantSettings:
    return AssistantSettings()
