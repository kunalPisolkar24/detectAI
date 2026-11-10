import io
import pickle

_ALLOWED_UNPICKLE_MODULES = frozenset(
    {"sklearn", "scipy", "numpy", "builtins", "collections", "copyreg"}
)


class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str):  # type: ignore[override]
        if module.split(".")[0] not in _ALLOWED_UNPICKLE_MODULES:
            raise pickle.UnpicklingError(f"Blocked unpickle of {module}.{name}")
        return super().find_class(module, name)


def load_pickle(path: str):
    with open(path, "rb") as f:
        data = f.read()
    return RestrictedUnpickler(io.BytesIO(data)).load()
