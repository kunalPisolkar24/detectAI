"""Config plane selection: the boot picks its plane through this factory.

create(env_type) owns the fail-closed flick: prod only when the trimmed,
lowercased value is exactly prod; any other value logs a warning and boots
the dev plane. The prod wiring (client factory plus both AWS adapters)
imports lazily inside the method, so dev boots never pay for boto3.
"""

from ..provider import ConfigProvider


class ConfigFactory:
    """Builds the ConfigProvider for a plane; construct once and call once.

    Prod wiring reads the bootstrap environment through AWSClientFactory
    (AWS_REGION required — ConfigFetchError names the var; EMULATOR_ENDPOINT
    optional override for the emulator plane), then composes ProdConfig over
    ParameterStoreAdapter and SecretsManagerAdapter. Dev wiring composes
    DevConfig over a default-path DotEnvAdapter.
    """

    def create(self, env_type: str) -> ConfigProvider:
        raise NotImplementedError
