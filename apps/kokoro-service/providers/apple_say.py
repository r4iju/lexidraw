from __future__ import annotations

import os
import subprocess
import tempfile
import re
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

        locale_re = re.compile(r"^[a-z]{2}_[A-Z]{2}$")
        for line in out.splitlines():
            # keep only the segment before '#'
            parts = line.split("#", 1)[0].strip()
            if not parts:
                continue
            cols = parts.split()
            if not cols:
                continue
            vid = cols[0]
            # search for a token that looks like en_US, ja_JP, sv_SE, etc.
            lang = ""
            for tok in cols[1:]:
                if locale_re.match(tok):
                    lang = tok
                    break
            # If we didn't find a valid locale token, skip (novelty or sfx voices)
            if not lang:
                continue
            res.append({"id": vid, "lang": lang})
        # Dedupe by (id, lang) while preserving order
        seen: set[Tuple[str, str]] = set()
        uniq: List[Dict[str, str]] = []
        for v in res:
            key = (v.get("id", ""), v.get("lang", ""))
            if key in seen:
                continue
            seen.add(key)
            uniq.append(v)
        self._cached_voices = uniq
        return uniq

    def _pick_voice(self, voiceId: Optional[str], languageCode: Optional[str]) -> str:
        # If the caller passed a locale string as voiceId by mistake, treat it as languageCode
        if voiceId and re.match(r"^[a-z]{2}([-_][A-Z]{2})?$", voiceId):
            languageCode = voiceId
            voiceId = None

        if voiceId:
            return voiceId  # explicit voice wins

        # No explicit voice: try to choose by language
        if languageCode:
            code = languageCode.replace("-", "_")
            voices = self.voices()

            # exact locale match (e.g., sv_SE)
            for v in voices:
                if v["lang"] == code:
                    return v["id"]

            # fallback: language-only match (e.g., sv_*)
            lang = code.split("_", 1)[0]
            for v in voices:
                if v["lang"].startswith(lang + "_"):
                    return v["id"]

        # final fallback
        return "Alex"

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
        voice = self._pick_voice(voiceId, languageCode)
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
