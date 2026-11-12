from ...core.modules import JobTypeSpec, MigrationDescriptor, ModuleSpec
from .jobs import optimize_handler
from .models import OptimizationRun, SavedOptimizationPlan
from .router import router
from .settings import get_rotation_settings

module = ModuleSpec(
    name="rotation_optimizer",
    requires=("database", "auth", "field_shift", "agri_data", "jobs"),
    routers=(router,),
    models=(OptimizationRun, SavedOptimizationPlan),
    migrations=(MigrationDescriptor("rotation_optimizer"),),
    job_handlers=(
        JobTypeSpec(
            "rotation.optimize",
            optimize_handler,
            timeout_seconds=150,
            maximum_attempts=2,
            concurrency_limit=1,
        ),
    ),
    settings_factory=get_rotation_settings,
    optional_env=("ROTATION_SOLVE_SECONDS", "ROTATION_MAX_PENDING_PER_OWNER"),
)
