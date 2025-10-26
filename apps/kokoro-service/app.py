from __future__ import annotations

import io
import os
from typing import Optional, Tuple
from pathlib import Path
import logging
from logging.handlers import RotatingFileHandler

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field
from providers.kokoro_adapter import KokoroProvider
from providers.apple_say import AppleSayProvider
from providers.xtts import XTTSProvider

try:
    # Kokoro pipeline loads models/voices and keeps them in memory
    from kokoro import KPipeline  # type: ignore
except Exception as e:  # pragma: no cover
    raise RuntimeError(
        f"Failed to import kokoro. Ensure 'kokoro' is installed in this environment. Error: {e}"
    )


class SpeechIn(BaseModel):
    model: Optional[str] = Field(default=None, description="Model id for API parity")
    input: str = Field(description="Text to synthesize")
    voice: str = Field(default="af_heart", description="Kokoro voice id")
    format: str = Field(
        default="wav", pattern="^(mp3|ogg|wav)$", description="Output format"
    )
    # Keep these fields for API compatibility, but they are ignored in the minimal path
    speed: float = Field(default=1.0, description="Playback speed multiplier (ignored)")
    sample_rate: int = Field(default=24000, description="Output sample rate (ignored)")
    # New optional routing hints
    provider: Optional[str] = Field(
        default=None, description="kokoro | apple_say | xtts"
    )
    languageCode: Optional[str] = Field(
        default=None, description="ja-JP, sv-SE, en-US, …"
    )


LOG_FILE = os.environ.get("KOKORO_LOG_FILE") or os.path.join(
    os.path.dirname(__file__),
    "uvicorn.log",
)

# Configure file logging (rotating)
_handler = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=2)
_handler.setFormatter(
    logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
)
for _name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
    _lg = logging.getLogger(_name)
    if not any(isinstance(h, RotatingFileHandler) for h in _lg.handlers):
        _lg.addHandler(_handler)
    if _lg.level == logging.NOTSET:
        _lg.setLevel(logging.INFO)
app_logger = logging.getLogger("kokoro-service")
if not any(isinstance(h, RotatingFileHandler) for h in app_logger.handlers):
    app_logger.addHandler(_handler)
if app_logger.level == logging.NOTSET:
    app_logger.setLevel(logging.INFO)

APP_TOKEN = os.environ.get("APP_TOKEN") or os.environ.get("KOKORO_BEARER")
LANG_CODE = os.environ.get("KOKORO_LANG", "en-us")
app_logger.info("startup: lang=%s has_token=%s", LANG_CODE, bool(APP_TOKEN))

# Detect MP3 capability (pydub + ffmpeg available)
try:
    from pydub import AudioSegment  # type: ignore

    try:
        from pydub.utils import which  # type: ignore
    except Exception:  # pragma: no cover
        which = None  # type: ignore
    _ffmpeg_path = None if which is None else which("ffmpeg")
    MP3_CAPABLE = _ffmpeg_path is not None
except Exception:  # pragma: no cover
    AudioSegment = None  # type: ignore
    MP3_CAPABLE = False

# Preload on startup to avoid cold starts and repeated downloads
pipe = KPipeline(lang_code=LANG_CODE)

# Provider registry
_providers: dict[str, object] = {
    "kokoro": KokoroProvider(pipe),
}

# Instantiate optional providers defensively
try:
    _apple = AppleSayProvider()
    if _apple.is_available():
        _providers["apple_say"] = _apple
except Exception:
    pass
try:
    _xtts = XTTSProvider(
        speakers_dir=str(Path(__file__).parent / "assets" / "speakers")
    )
    _providers["xtts"] = _xtts
    # Warm up XTTS briefly (lazy-loads torch/TTS internally)
    try:
        _xtts.warmup()
    except Exception:
        pass
except Exception:
    pass


def _choose_provider(requested: Optional[str], language_code: Optional[str]) -> str:
    """Select provider by explicit request or language hint (non-EN -> xtts/apple)."""
    if requested and requested in _providers:
        return requested
    if language_code and not language_code.lower().startswith("en"):
        if "apple_say" in _providers and language_code.lower().startswith(("ja", "sv")):
            return "apple_say"
        if "xtts" in _providers:
            return "xtts"
    return "kokoro"


app = FastAPI(title="Kokoro TTS Sidecar", version="0.1.0")


@app.get("/healthz")
def healthz():
    try:
        import torch  # type: ignore

        mps_ok = bool(
            getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
        )
    except Exception:
        mps_ok = False
    apple_ok = "apple_say" in _providers
    return {
        "ok": True,
        "lang": LANG_CODE,
        "mp3": bool(MP3_CAPABLE),
        "apple_say": apple_ok,
        "mps": mps_ok,
    }


# Dynamic voice discovery from local checkpoints (default to app folder voices/)
VOICES_DIR = Path(
    os.environ.get("KOKORO_VOICES_DIR", str(Path(__file__).parent / "voices"))
)


@app.get("/v1/voices")
def list_voices(rich: bool = False):
    # Back-compat: default returns Kokoro voice ids (string[])
    if not rich:
        try:
            if VOICES_DIR.is_dir():
                names = {p.stem for p in VOICES_DIR.glob("*.pt")}
                names.update({p.stem for p in VOICES_DIR.glob("*.pth")})
                if names:
                    return {"voices": sorted(names)}
        except Exception as ex:
            app_logger.warning("voices scan failed: %s", repr(ex))
        # Fallback
        app_logger.warning("voices scan failed, falling back to default voice")
        return {"voices": ["af_heart"]}

    # rich=true: merge across providers with metadata
    voices: list[dict[str, str]] = []
    # Kokoro
    try:
        if VOICES_DIR.is_dir():
            names = {p.stem for p in VOICES_DIR.glob("*.pt")} | {
                p.stem for p in VOICES_DIR.glob("*.pth")
            }
            voices += [
                {"id": n, "provider": "kokoro", "lang": LANG_CODE}
                for n in sorted(names)
            ]
    except Exception as ex:
        app_logger.warning("voices scan failed: %s", repr(ex))
    # Apple say
    if "apple_say" in _providers:
        try:
            apple = _providers["apple_say"]
            for v in apple.voices():  # type: ignore[attr-defined]
                voices.append(
                    {
                        "id": v.get("id", ""),
                        "provider": "apple_say",
                        "lang": v.get("lang", ""),
                    }
                )
        except Exception:
            pass
    # XTTS speakers
    if "xtts" in _providers:
        try:
            xtts = _providers["xtts"]
            for spk in xtts.list_speakers():  # type: ignore[attr-defined]
                voices.append({"id": spk.get("id", ""), "provider": "xtts", "lang": ""})
        except Exception:
            pass
    if not voices:
        return {"voices": ["af_heart"]}
    return {"voices": voices}


def synth_kokoro(text: str, voice: str) -> tuple[np.ndarray, int]:
    """Iterate Kokoro generator and concatenate audio chunks to a single array."""
    chunks: list[np.ndarray] = []
    for _, _, audio in pipe(text, voice=voice):
        if hasattr(audio, "detach") and hasattr(audio, "cpu"):
            audio = audio.detach().cpu().numpy()
        chunks.append(np.asarray(audio, dtype=np.float32).ravel())
    if not chunks:
        raise HTTPException(status_code=422, detail="Kokoro returned no audio")
    return np.concatenate(chunks), 24000


@app.post("/v1/audio/speech")
def tts(req: SpeechIn, authorization: Optional[str] = Header(default=None)):
    if APP_TOKEN and authorization != f"Bearer {APP_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    provider_key = _choose_provider(req.provider, req.languageCode)
    app_logger.info(
        "incoming tts: provider=%s voice=%s fmt=%s lang=%s text_len=%s",
        provider_key,
        req.voice,
        req.format,
        req.languageCode or "",
        len(req.input or ""),
    )

    provider = _providers.get(provider_key)
    if provider is None:
        raise HTTPException(
            status_code=422, detail="No suitable TTS provider available"
        )
    # For XTTS, fail fast if no speaker can be resolved
    if provider_key == "xtts":
        try:
            # type: ignore[attr-defined]
            audio, sr = provider.synthesize(
                text=req.input,
                voiceId=req.voice,
                speed=req.speed,
                languageCode=req.languageCode,
            )
        except ValueError as e:
            from pathlib import Path as _P

            sp = _P(__file__).parent / "assets" / "speakers" / f"{req.voice}.wav"
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{e}. Ensure speaker_wav at {sp} exists or choose a builtin speaker."
                ),
            )
    else:
        # type: ignore[attr-defined]
        audio, sr = provider.synthesize(
            text=req.input,
            voiceId=req.voice,
            speed=req.speed,
            languageCode=req.languageCode,
        )

    # Validate audio content
    if not isinstance(audio, np.ndarray) or audio.size == 0:
        raise HTTPException(status_code=422, detail="Kokoro returned empty audio")
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if audio.size < 1000 or peak < 1e-7:
        raise HTTPException(status_code=422, detail="Kokoro returned silent audio")

    # Peak normalization to ~-1 dBFS (avoid clipping)
    norm_target = 10 ** (-1.0 / 20.0)
    if peak > 0 and peak > norm_target:
        audio = (audio / peak) * norm_target

    # Encode canonical WAV
    wav_buf = io.BytesIO()
    sf.write(
        wav_buf,
        audio.astype(np.float32, copy=False),
        int(sr),
        format="WAV",
        subtype="PCM_16",
    )
    wav_buf.seek(0)

    # Always dump WAV to filesystem for inspection
    try:
        import time as _time

        dump_dir = os.path.join(os.path.dirname(__file__), "wav")
        os.makedirs(dump_dir, exist_ok=True)
        ts = str(_time.time_ns())
        safe_voice = (
            "".join(c for c in (req.voice or "voice") if c.isalnum() or c in ("-", "_"))
            or "voice"
        )
        dump_path = os.path.join(dump_dir, f"tts-{provider_key}-{safe_voice}-{ts}.wav")
        with open(dump_path, "wb") as _f:
            _f.write(wav_buf.getvalue())
        app_logger.info("dumped wav to %s", dump_path)
    except Exception as _ex:
        app_logger.warning("failed to dump wav: %s", repr(_ex))

    fmt = (req.format or "wav").lower()
    if fmt == "wav":
        data = wav_buf.getvalue()
        app_logger.info("out wav bytes=%s sr=%s", len(data), sr)
        return Response(content=data, media_type="audio/wav")

    if fmt == "mp3":
        if not MP3_CAPABLE or AudioSegment is None:
            app_logger.warning("mp3 export unavailable: pydub/ffmpeg missing")
            raise HTTPException(
                status_code=415,
                detail="MP3 requires pydub + ffmpeg installed and on PATH",
            )
        try:
            seg = AudioSegment.from_file(wav_buf, format="wav")
            out = io.BytesIO()
            seg.export(out, format="mp3", bitrate="192k")
            data = out.getvalue()
            # Always dump MP3 to filesystem
            try:
                import time as _time

                dump_dir_mp3 = os.path.join(os.path.dirname(__file__), "mp3")
                os.makedirs(dump_dir_mp3, exist_ok=True)
                ts_mp3 = str(_time.time_ns())
                safe_voice_mp3 = (
                    "".join(
                        c
                        for c in (req.voice or "voice")
                        if c.isalnum() or c in ("-", "_")
                    )
                    or "voice"
                )
                dump_mp3_path = os.path.join(
                    dump_dir_mp3, f"tts-{provider_key}-{safe_voice_mp3}-{ts_mp3}.mp3"
                )
                with open(dump_mp3_path, "wb") as _fmp3:
                    _fmp3.write(data)
                app_logger.info("dumped mp3 to %s", dump_mp3_path)
            except Exception as _exm:
                app_logger.warning("failed to dump mp3: %s", repr(_exm))
            app_logger.info("out mp3 bytes=%s sr=%s", len(data), sr)
            return Response(content=data, media_type="audio/mpeg")
        except HTTPException:
            raise
        except Exception as ex:
            app_logger.warning("mp3 export failed: %s", repr(ex))
            raise HTTPException(
                status_code=415,
                detail="MP3 export failed; ensure ffmpeg is installed and accessible",
            )

    if fmt == "ogg":
        raise HTTPException(status_code=415, detail="OGG not supported")

    # Default to WAV on unknown format
    data = wav_buf.getvalue()
    app_logger.info("out wav-default bytes=%s sr=%s", len(data), sr)
    return Response(content=data, media_type="audio/wav")
