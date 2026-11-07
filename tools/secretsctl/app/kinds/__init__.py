"""The kind registry: the one seam between the engine and every stack flavor.

A Kind describes one stack family end to end: which declaration file opts a
stack in, where its values file lives, which terraform root it drives when the
kind vendors one, and the flavor-specific callables the engine's shared
machinery needs (declaration load, TF vars, seeder policy, value rules).
main.py is the only engine-side reader of this registry, so wiring stays
explicit."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.engine.declaration.model import Declaration

Values = dict[str, str]


@dataclass
class Kind:
    name: str
    declaration_filename: str
    values_relpath: str
    stack_root: Path | None
    load: Callable[[Path], Declaration]
    build_tf_vars: Callable[[Declaration, Values, bool], dict[str, str]]
    seeder_policy: Callable[[Declaration, Values, bool, str], dict]
    validate: Callable[[Declaration, Values, bool], list[str]]
    my_verbs: tuple[str, ...] = ()
    service_scoped: bool = False
    terraform_flow: Callable[..., int] | None = None


KINDS: dict[str, Kind] = {}


def register(kind: Kind) -> None:
    KINDS[kind.name] = kind


def by_name(name: str) -> Kind:
    return KINDS[name]
