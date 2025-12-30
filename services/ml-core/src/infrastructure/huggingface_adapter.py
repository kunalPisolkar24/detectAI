from huggingface_hub import HfApi
from src.interfaces.registry import IModelRegistry
from src.domain.schemas import ArtifactBundle
from src.core.exceptions import UploadFailedException

class HuggingFaceRegistry(IModelRegistry):
    def __init__(self, token: str, username: str):
        self._api = HfApi(token=token)
        self._username = username

    def _get_repo_id(self, model_key: str) -> str:
        return f"{self._username}/{model_key}"

    def upload_artifacts(self, bundle: ArtifactBundle) -> str:
        repo_id = self._get_repo_id(bundle.metadata.model_key)
        try:
            url = self._api.upload_folder(
                folder_path=str(bundle.local_path),
                repo_id=repo_id,
                repo_type="model",
                commit_message=f"Upload artifacts for version {bundle.metadata.version}"
            )
            return str(url)
        except Exception as e:
            raise UploadFailedException(f"Failed to upload to HF: {str(e)}") from e

    def set_version_tag(self, bundle: ArtifactBundle) -> None:
        repo_id = self._get_repo_id(bundle.metadata.model_key)
        try:
            self._api.create_tag(
                repo_id=repo_id,
                tag=bundle.metadata.version,
                tag_message=bundle.metadata.description
            )
        except Exception as e:
            raise UploadFailedException(f"Failed to tag version on HF: {str(e)}") from e