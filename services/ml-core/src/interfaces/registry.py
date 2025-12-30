from abc import ABC, abstractmethod
from src.domain.schemas import ArtifactBundle

class IModelRegistry(ABC):
    @abstractmethod
    def upload_artifacts(self, bundle: ArtifactBundle) -> str:
        pass

    @abstractmethod
    def set_version_tag(self, bundle: ArtifactBundle) -> None:
        pass