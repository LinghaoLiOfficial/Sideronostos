from ...core.modules import MigrationDescriptor, ModuleSpec
from .models import GroupInvitation, Notification
from .router import router

module = ModuleSpec(
    name="collaboration",
    requires=("auth", "personal_schedule", "workspace_files"),
    routers=(router,),
    models=(GroupInvitation, Notification),
    migrations=(MigrationDescriptor("collaboration"),),
)
