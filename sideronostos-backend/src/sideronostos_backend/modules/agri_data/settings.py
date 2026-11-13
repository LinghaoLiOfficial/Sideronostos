from functools import lru_cache
from pathlib import Path

from ...core.config import EnvironmentSettings


class AgriDataSettings(EnvironmentSettings):
    model_config = EnvironmentSettings.model_config | {"env_prefix": "AGRI_DATA_"}
    asset_root: Path = Path("../data/releases/science")


@lru_cache
def get_agri_data_settings() -> AgriDataSettings:
    return AgriDataSettings()
