from dataclasses import dataclass, field


@dataclass(frozen=True)
class SeedConfig:
    env_file: str
    endpoint_url: str | None  # None or "" == real AWS
    region: str = "ap-south-1"
    dry_run: bool = False
    only: frozenset[str] | None = None
    force: bool = False
    confirm_prod: bool = False

    @property
    def is_real_aws(self) -> bool:
        return not self.endpoint_url


@dataclass
class SecretPayload:
    name: str
    data: dict[str, str] = field(default_factory=dict)

    def is_empty(self) -> bool:
        return not self.data
