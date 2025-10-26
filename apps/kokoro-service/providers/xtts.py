from __future__ import annotations

import os
from glob import glob
from typing import Optional, Tuple, Dict, List

import numpy as np


class XTTSProvider:
    name: str = "xtts"
    maxCharsPerRequest: int = 1200
    supportsSsml: bool = False

    def __init__(self, speakers_dir: str = "assets/speakers") -> None:
        self.speakers_dir = speakers_dir
        self._tts = None  # lazy load to avoid import cost when unused
        self._device = None
        self._builtin_speakers: list[str] = []
        self._default_speaker: str | None = None

    def _ensure_loaded(self) -> None:
        if self._tts is not None:
            return
        # Import here to make provider optional
        import torch  # type: ignore
        from TTS.api import TTS  # type: ignore

        # Allowlist Coqui config classes for torch>=2.6 weights_only default
        try:  # pragma: no cover - defensive for varying versions
            from TTS.tts.configs.xtts_config import XttsConfig  # type: ignore

            try:
                from TTS.tts.models.xtts import (  # type: ignore
                    XttsArgs,
                    XttsAudioConfig,
                )

                torch.serialization.add_safe_globals(
                    [XttsConfig, XttsArgs, XttsAudioConfig]
                )
            except Exception:
                torch.serialization.add_safe_globals([XttsConfig])
        except Exception:
            pass

        self._device = (
            "mps"
            if getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
            else "cpu"
        )
        self._tts = TTS(
            "tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False
        ).to(self._device)
        # Capture builtin speaker names if available (for cases without speaker_wav)
        try:
            # Prefer deep introspection which is stable across TTS versions
            synth = getattr(self._tts, "synthesizer", None)
            tts_model = getattr(synth, "tts_model", None)
            spk_mgr = getattr(tts_model, "speaker_manager", None)
            names = getattr(spk_mgr, "speaker_names", None)
            if isinstance(names, (list, tuple)) and names:
                self._builtin_speakers = list(names)
                self._default_speaker = self._builtin_speakers[0]
            else:
                # Fallback to top-level attribute if exposed
                spk_list = getattr(self._tts, "speakers", None)
                if isinstance(spk_list, list) and spk_list:
                    self._builtin_speakers = spk_list
                    self._default_speaker = spk_list[0]
        except Exception:
            pass

    def list_speakers(self) -> List[Dict[str, str]]:
        if not os.path.isdir(self.speakers_dir):
            return []
        out: List[Dict[str, str]] = []
        for p in sorted(glob(os.path.join(self.speakers_dir, "*.wav"))):
            vid = os.path.splitext(os.path.basename(p))[0]
            out.append({"id": vid})
        return out

    def _speaker_path(self, voiceId: Optional[str]) -> Optional[str]:
        if not voiceId:
            return None
        p = os.path.join(self.speakers_dir, f"{voiceId}.wav")
        return p if os.path.exists(p) else None

    def warmup(self) -> None:
        try:
            self._ensure_loaded()
            # Use a valid speaker for warmup: prefer a local wav, else a builtin if available
            first_wav = None
            try:
                for p in sorted(glob(os.path.join(self.speakers_dir, "*.wav"))):
                    first_wav = p
                    break
            except Exception:
                first_wav = None
            if first_wav:
                _ = self._tts.tts(
                    text="test", language="ja", speaker_wav=first_wav, speed=1.0
                )
            elif self._default_speaker:
                _ = self._tts.tts(
                    text="test", language="ja", speaker=self._default_speaker, speed=1.0
                )
        except Exception:
            pass

    def synthesize(
        self,
        *,
        text: str,
        voiceId: Optional[str],
        speed: Optional[float],
        languageCode: Optional[str] | None = None,
    ) -> Tuple[np.ndarray, int]:
        self._ensure_loaded()
        lang = (languageCode or "en").split("-")[0]
        spk_wav = self._speaker_path(voiceId)
        kwargs = {"text": text, "language": lang, "speed": speed or 1.0}
        if spk_wav:
            kwargs["speaker_wav"] = spk_wav
            print(f"[xtts] using speaker_wav: {spk_wav} lang={lang}")
        else:
            # Try builtin speakers (if any)
            chosen = None
            if voiceId and self._builtin_speakers and voiceId in self._builtin_speakers:
                chosen = voiceId
            elif self._default_speaker:
                chosen = self._default_speaker
            if chosen:
                kwargs["speaker"] = chosen
                print(f"[xtts] using builtin speaker: {chosen} lang={lang}")
            else:
                raise ValueError(
                    "XTTS requires a speaker. Provide voiceId that maps to "
                    "assets/speakers/<voiceId>.wav (speaker_wav) or pick a valid builtin speaker."
                )
        wav = self._tts.tts(**kwargs)
        audio = np.asarray(wav, dtype=np.float32).ravel()
        return audio, 24000
