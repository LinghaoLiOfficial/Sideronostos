from ...core.modules import MigrationDescriptor, ModuleSpec
from .models import KBActivation, KBRelease, KnowledgeChunk, KnowledgeClaim, KnowledgeSource
from .settings import get_knowledge_settings

module = ModuleSpec(
    name="knowledge",
    requires=("database", "ai"),
    models=(KBRelease, KBActivation, KnowledgeSource, KnowledgeChunk, KnowledgeClaim),
    migrations=(MigrationDescriptor("knowledge"),),
    settings_factory=get_knowledge_settings,
    optional_env=(
        "KNOWLEDGE_LIBRARY_ROOT",
        "KNOWLEDGE_ASSET_ROOT",
        "KNOWLEDGE_EMBEDDING_MODEL",
        "KNOWLEDGE_EMBEDDING_DIMENSIONS",
        "KNOWLEDGE_API_KEY",
        "KNOWLEDGE_BASE_URL",
    ),
)
