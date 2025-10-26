from __future__ import annotations

import os
import subprocess
import tempfile
from typing import List, Dict, Optional, Tuple

import numpy as np
import soundfile as sf


class AppleSayProvider:
    name: str = "apple_say"
    maxCharsPerRequest: int = 10000
    supportsSsml: bool = False

    def __init__(self) -> None:
        self._available: Optional[bool] = None
        self._cached_voices: Optional[List[Dict[str, str]]] = None

    def is_available(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            subprocess.run(
                ["say", "-v", "?"], capture_output=True, text=True, check=True
            )
            self._available = True
        except Exception:
            self._available = False
        return self._available

    def voices(self) -> List[Dict[str, str]]:
        if self._cached_voices is not None:
            return self._cached_voices
        out = ""
        try:
            out = subprocess.run(
                ["say", "-v", "?"], capture_output=True, text=True, check=True
            ).stdout
        except Exception:
            return []
        res: List[Dict[str, str]] = []
        for line in out.splitlines():
            # Format typically: "Kyoko               Japanese      # ..."
            parts = line.split("#", 1)[0].strip()
            if not parts:
                continue
            cols = parts.split()
            vid = cols[0]
            lang = cols[1] if len(cols) > 1 else ""
            res.append({"id": vid, "lang": lang})
        self._cached_voices = res
        return res

    def synthesize(
        self,
        *,
        text: str,
        voiceId: Optional[str],
        speed: Optional[float],
        languageCode: Optional[str] | None = None,
    ) -> Tuple[np.ndarray, int]:
        if not self.is_available():
            raise RuntimeError("apple_say is not available on this system")
        voice = voiceId or "Alex"
        # Map speed multiplier (1.0 ~ 190 wpm baseline)
        base_wpm = 190
        mul = 1.0 if speed is None else float(speed)
        wpm = max(80, min(450, int(base_wpm * mul)))
        with tempfile.TemporaryDirectory() as td:
            aiff = os.path.join(td, "out.aiff")
            # Use -o to write AIFF and then load via soundfile
            subprocess.run(
                ["say", "-v", voice, "-r", str(wpm), "-o", aiff, text], check=True
            )
            audio, sr = sf.read(aiff, dtype="float32", always_2d=False)
            if isinstance(audio, np.ndarray) and audio.ndim > 1:
                # mixdown to mono
                audio = audio.mean(axis=1)
            arr = np.asarray(audio, dtype=np.float32).ravel()
            return arr, int(sr)
