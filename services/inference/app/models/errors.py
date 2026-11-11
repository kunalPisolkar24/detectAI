"""Shared model artifact error vocabulary; colocate in its raiser, graduate here with a second."""


class ArtifactError(RuntimeError):
    """Root of the artifact plane's failures; catch this for blanket handling."""


class MissingArtifact(ArtifactError):
    """The artifact is not present locally at the pinned revision; locate's normal miss."""


class ArtifactPullError(ArtifactError):
    """A hub pull failed after its retries; the message names the repo and the cause."""
