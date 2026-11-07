from ...core.modules import MigrationDescriptor, ModuleSpec
from .models import GroupPersonalScheduleDay, PersonalScheduleDay
from .router import router

module = ModuleSpec(
    name="personal_schedule",
    requires=("auth",),
    routers=(router,),
    models=(PersonalScheduleDay, GroupPersonalScheduleDay),
    migrations=(MigrationDescriptor("personal_schedule"),),
)
