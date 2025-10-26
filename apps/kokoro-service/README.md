## Kokoro TTS Sidecar (macOS-friendly setup)

These are manual, copy-pasteable steps; nothing is automated in scripts.

### 0) Install Miniconda

```bash
brew install --cask miniconda
```

Optional for Apple Silicon/Metal acceleration:

```bash
export KOKORO_DEVICE=mps
```

### 1) Create a fresh Python 3.12 env

```bash
conda create -n kokoro312 python=3.12 -y
conda activate kokoro312
python -V
```

(Conda basics: see the Conda Documentation)

### 2) Upgrade pip tooling

```bash
python -m pip install -U pip setuptools wheel
```

### 3) Prefer wheels (optional but helpful)

```bash
export PIP_ONLY_BINARY=":all:"
```

### 4) Install Kokoro + SoundFile

```bash
pip install "kokoro==0.7.16" soundfile
```

Why this works: Python 3.12 has prebuilt wheels for spaCy/Thinc deps used under the hood. Earlier failure modes were due to building against Python 3.14.

### 5) Sanity check

```bash
python - <<'PY'
import kokoro, soundfile
print("kokoro:", kokoro.__version__)
print("soundfile ok")
PY
```

### 6) Run locally

From repo root:

```bash
brew install ffmpeg  # required for mp3/ogg encoding
export KOKORO_BEARER=dev-token
export KOKORO_LANG=en-us
uvicorn app:app --host 127.0.0.1 --port 8010 --reload --app-dir apps/kokoro-service
```

Then set in `apps/lexidraw/.env.development`:

```env
KOKORO_URL=http://127.0.0.1:8010
KOKORO_BEARER=dev-token
```

Now `bun run dev` will prefer Kokoro for TTS locally.

### Apple “say” and Coqui XTTS-v2 (optional providers)

- Apple “say” (macOS only) is auto-detected if the `say` CLI is available and voices are installed (System Settings → Accessibility → Spoken Content → Manage Voices…).
- Coqui XTTS-v2 loads on-demand and uses MPS if available. Place 3–10s mono reference WAVs under `apps/kokoro-service/assets/speakers/` to enable speaker cloning.

Health check now reports provider availability:

```bash
curl http://127.0.0.1:8010/healthz
# {"ok":true,"lang":"en-us","mp3":true,"apple_say":true|false,"mps":true|false}
```

List voices (back-compat):

```bash
curl http://127.0.0.1:8010/v1/voices
# {"voices":["af_heart", ...]}
```

List voices (rich):

```bash
curl "http://127.0.0.1:8010/v1/voices?rich=true"
# {"voices":[{"id":"Kyoko","provider":"apple_say","lang":"Japanese"}, ...]}
```

Synthesize with Apple (Japanese):

```bash
curl -X POST http://127.0.0.1:8010/v1/audio/speech \
  -H "Authorization: Bearer $KOKORO_BEARER" \
  -H "Content-Type: application/json" \
  --output out.wav \
  -d '{"input":"これはテストです。","provider":"apple_say","voice":"Kyoko","format":"wav","languageCode":"ja-JP"}'
```

Synthesize with XTTS (Swedish):

```bash
curl -X POST http://127.0.0.1:8010/v1/audio/speech \
  -H "Authorization: Bearer $KOKORO_BEARER" \
  -H "Content-Type: application/json" \
  --output out.mp3 \
  -d '{"input":"Detta är ett test.","provider":"xtts","voice":"sv_male","format":"mp3","languageCode":"sv-SE"}'
```
