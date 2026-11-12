from functools import lru_cache

from pydantic import Field

from ...core.config import EnvironmentSettings


class RotationSettings(EnvironmentSettings):
    model_config = EnvironmentSettings.model_config | {"env_prefix": "ROTATION_"}
    solve_seconds: float = Field(default=30, gt=0, le=60)
    max_pending_per_owner: int = Field(default=3, ge=1, le=10)


@lru_cache
def get_rotation_settings() -> RotationSettings:
    return RotationSettings()
