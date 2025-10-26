# scripts/prefetch_kokoro_voices.py
import os
from huggingface_hub import hf_hub_download, list_repo_files

REPO = os.environ.get("KOKORO_REPO", "hexgrad/Kokoro-82M")
os.makedirs("voices", exist_ok=True)


def prefetch(selected=None):
    files = list_repo_files(REPO)
    all_voice_files = [
        f for f in files if f.startswith("voices/") and f.endswith(".pt")
    ]
    names = sorted(f.rsplit("/", 1)[-1].removesuffix(".pt") for f in all_voice_files)
    want = names if not selected else [v for v in selected if v in names]
    for v in want:
        hf_hub_download(
            REPO,
            filename=f"voices/{v}.pt",
            local_dir=".",  # downloads into ./assets/kokoro-voices
            local_dir_use_symlinks=False,
        )
    return want


if __name__ == "__main__":
    got = prefetch()  # or prefetch(["af_heart","af_..."])
    print(f"prefetched {len(got)} voices")
