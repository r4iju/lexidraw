from __future__ import annotations

from typing import Tuple, Optional

import numpy as np


class KokoroProvider:
    name: str = "kokoro"
    maxCharsPerRequest: int = 20000
    supportsSsml: bool = False

    def __init__(self, pipeline) -> None:
        self.pipe = pipeline

    def synthesize(
        self,
        *,
        text: str,
        voiceId: Optional[str],
        speed: Optional[float],
        languageCode: Optional[str] | None = None,
    ) -> Tuple[np.ndarray, int]:
        chunks = []
        for _, _, audio in self.pipe(text, voice=voiceId or "af_heart"):
            if hasattr(audio, "detach") and hasattr(audio, "cpu"):
                audio = audio.detach().cpu().numpy()
            chunks.append(np.asarray(audio, dtype=np.float32).ravel())
        if not chunks:
            return np.zeros((0,), dtype=np.float32), 24000
        return np.concatenate(chunks), 24000
