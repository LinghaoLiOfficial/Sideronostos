from ...core.modules import MigrationDescriptor, ModuleSpec
from .models import RegionSelection, ScienceRelease
from .router import router
from .settings import get_agri_data_settings

module = ModuleSpec(
    name="agri_data",
    requires=("database", "auth"),
    routers=(router,),
    models=(RegionSelection, ScienceRelease),
    migrations=(MigrationDescriptor("agri_data"),),
    settings_factory=get_agri_data_settings,
    optional_env=("AGRI_DATA_ASSET_ROOT",),
)
