"""The transport layer: HTTP-shaped rules and nothing else.

auth.py guards the key, extract.py owns the bounded read, multipart
parsing, and the typed-failures-to-wire mapping. Every content judgment
lives down the dependency direction, never here — this package imports
the domain's vocabulary and services, and nothing imports back into it
except the composition root.
"""
