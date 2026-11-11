"""The config plane: typed contract plus adapters, split across submodules."""

from .adapters.dotenv import DotEnvAdapter, DotEnvError
from .adapters.parameters import ParameterStoreAdapter
from .adapters.secrets_manager import SecretsManagerAdapter
from .errors import ConfigError, ConfigFetchError
from .factories.aws_client_factory import AWSClientFactory
from .factories.config_factory import ConfigFactory
from .provider import ConfigProvider, DevConfig, ProdConfig
from .settings import Settings, deployment_flick

__all__ = [
    "AWSClientFactory",
    "ConfigError",
    "ConfigFactory",
    "ConfigFetchError",
    "ConfigProvider",
    "DevConfig",
    "DotEnvAdapter",
    "DotEnvError",
    "ParameterStoreAdapter",
    "ProdConfig",
    "SecretsManagerAdapter",
    "Settings",
    "deployment_flick",
]
