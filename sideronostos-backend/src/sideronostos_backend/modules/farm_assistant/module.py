from ...core.modules import MigrationDescriptor, ModuleSpec
from .models import AssistantMessage, Conversation, FarmerPreference
from .router import router
from .settings import get_assistant_settings

module = ModuleSpec(
    name="farm_assistant",
    requires=(
        "database",
        "auth",
        "ai",
        "knowledge",
        "agri_data",
        "field_shift",
        "rotation_optimizer",
    ),
    routers=(router,),
    models=(FarmerPreference, Conversation, AssistantMessage),
    migrations=(MigrationDescriptor("farm_assistant"),),
    settings_factory=get_assistant_settings,
    optional_env=(
        "ASSISTANT_DEADLINE_SECONDS",
        "ASSISTANT_HISTORY_MESSAGES",
        "ASSISTANT_RETRIEVAL_LIMIT",
    ),
)
