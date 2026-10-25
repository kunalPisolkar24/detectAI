"""Config plane selection: the boot picks its plane through this factory.

create(env_type) stays fail-closed: prod only when the trimmed, lowercased
value is exactly prod; anything unexpected warns and boots the dev plane.
The caller passes the deployment flick (settings.deployment_flick()), so
the value reaching here is already normalized.
"""

import logging

from ..adapters.dotenv import DotEnvAdapter
from ..adapters.parameters import ParameterStoreAdapter
from ..adapters.secrets_manager import SecretsManagerAdapter
from ..provider import ConfigProvider, DevConfig, ProdConfig
from .aws_client_factory import AWSClientFactory

logger = logging.getLogger(__name__)


class ConfigFactory:
    """Builds the ConfigProvider for a plane; stateless, call it per boot.

    Prod wiring reads the bootstrap environment through AWSClientFactory
    (AWS_REGION required — ConfigFetchError names the var; EMULATOR_ENDPOINT
    optional override for the emulator plane), then composes ProdConfig over
    the two AWS planes — the secrets adapter first, so a secret-plane failure
    lands before the SSM client even exists. Dev wiring composes DevConfig
    over a default-path DotEnvAdapter.
    """

    @classmethod
    def create(cls, env_type: str) -> ConfigProvider:
        if env_type.strip().lower() == "prod":
            clients = AWSClientFactory.from_env()
            secrets = SecretsManagerAdapter(clients.create_client("secretsmanager"))
            parameters = ParameterStoreAdapter(clients.create_client("ssm"))
            return ProdConfig(parameters, secrets)
        if env_type.strip().lower() != "dev":
            logger.warning("ENV_TYPE %r is neither dev nor prod; booting the dev plane", env_type)
        return DevConfig(DotEnvAdapter())
