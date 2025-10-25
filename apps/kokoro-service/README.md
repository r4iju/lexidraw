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
