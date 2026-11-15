from ...core.modules import MigrationDescriptor, ModuleSpec
from .models import AnalysisRecord, FieldRecord, FieldWorkspaceRecord, SavedPlanRecord
from .router import router

module = ModuleSpec(
    name="field_shift",
    requires=("database", "auth"),
    routers=(router,),
    models=(FieldRecord, FieldWorkspaceRecord, AnalysisRecord, SavedPlanRecord),
    migrations=(MigrationDescriptor("field_shift"),),
)
