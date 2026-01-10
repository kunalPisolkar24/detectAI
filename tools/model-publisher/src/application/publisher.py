from pathlib import Path
from src.interfaces.registry import IModelRegistry
from src.domain.schemas import ArtifactBundle, ModelMetadata
from src.core.config import settings
from src.core.exceptions import ArtifactNotFoundException

class ModelPublisher:
    def __init__(self, registry: IModelRegistry):
        self._registry = registry

    def publish(self, model_name: str, version: str) -> None:
        assets_path = Path(settings.project_root_dir) / settings.assets_dir_name / model_name
        
        if not assets_path.exists():
            raise ArtifactNotFoundException(f"Assets not found at {assets_path}")

        metadata = ModelMetadata(
            model_key=model_name,
            version=version,
            description=f"Production release {version}"
        )

        bundle = ArtifactBundle(
            metadata=metadata,
            local_path=assets_path
        )

        self._registry.upload_artifacts(bundle)
        self._registry.set_version_tag(bundle)