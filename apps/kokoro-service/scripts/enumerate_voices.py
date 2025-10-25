# scripts/list_kokoro_voices.py
from huggingface_hub import list_repo_files

REPO = "hexgrad/Kokoro-82M"

files = list_repo_files(REPO)
voices = sorted(
    f.rsplit("/", 1)[-1].removesuffix(".pt")
    for f in files
    if f.startswith("voices/") and f.endswith(".pt")
)
print("\n".join(voices))
