from __future__ import annotations

from .kokoro_adapter import KokoroProvider
from .apple_say import AppleSayProvider
from .xtts import XTTSProvider

__all__ = [
    "KokoroProvider",
    "AppleSayProvider",
    "XTTSProvider",
]
