"""Config plane selection; anything not exactly prod boots the dev plane."""

import logging

from ..adapters.dotenv import DotEnvAdapter
from ..adapters.parameters import ParameterStoreAdapter
from ..adapters.secrets_manager import SecretsManagerAdapter
from ..provider import ConfigProvider, DevConfig, ProdConfig
from .aws_client_factory import AWSClientFactory

logger = logging.getLogger(__name__)


class ConfigFactory:
    """Secrets adapter wires before SSM: a secrets failure lands before the SSM client exists."""

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
