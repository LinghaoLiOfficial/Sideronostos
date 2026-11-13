from ...core.modules import MigrationDescriptor, ModuleSpec
from .models import AnalysisRecord, FieldRecord, SavedPlanRecord
from .router import router

module = ModuleSpec(
    name="field_shift",
    requires=("database", "auth"),
    routers=(router,),
    models=(FieldRecord, AnalysisRecord, SavedPlanRecord),
    migrations=(MigrationDescriptor("field_shift"),),
)
