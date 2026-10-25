"""The typed contract, resolved once per boot from a config plane.

Settings declares exactly the fields the runtime consumes — today that is
api_key only (requirements.md); further fields land when their task lands
(the planes keep carrying the seeded keys either way, and from_provider
ignores whatever the model does not declare). Config selection lives in the
factories: the deployment flick picks the plane, the plane feeds the model.
"""

import os
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .provider import ConfigProvider


def deployment_flick() -> Literal["dev", "prod"]:
    """The plane selector: prod only when ENV_TYPE is exactly prod
    (trimmed, casefolded); anything else is dev — fail closed. It is a
    deployment variable read from the process environment, never from a
    file or AWS."""
    return "prod" if os.environ.get("ENV_TYPE", "").strip().lower() == "prod" else "dev"


class Settings(BaseModel):
    model_config = ConfigDict(validate_default=True)

    # requirements.md: the credential is mandatory in every environment and
    # must be at least 16 characters; an invalid value fails the boot. The
    # empty default plus default validation keeps missing and invalid keys
    # on the same min_length failure path instead of a "field required"
    # constructor error.
    api_key: str = Field(default="", min_length=16)

    @classmethod
    def from_provider(cls, provider: ConfigProvider) -> "Settings":
        """Build from a plane: one upper-snake lookup per declared field.

        The planes speak env names (upper snake), the model speaks field
        names. A seeded key without a matching field is ignored here —
        the consume-first rule — and a missing or invalid required key fails
        the boot on the field's own contract.
        """
        values: dict[str, str] = {}
        for name in cls.model_fields:
            value = provider.get(name.upper())
            if value is not None:
                values[name] = value
        return cls(**values)
