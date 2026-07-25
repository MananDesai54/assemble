#!/bin/zsh
# One-time local-AI toolchain setup: llama.cpp + whisper.cpp + models.
set -e
cd "$(dirname "$0")/.."

command -v brew >/dev/null || { echo "Homebrew required: https://brew.sh"; exit 1; }

echo "→ llama.cpp (llama-server)"
brew list llama.cpp &>/dev/null || brew install llama.cpp

echo "→ whisper.cpp (whisper-cli)"
brew list whisper-cpp &>/dev/null || brew install whisper-cpp

mkdir -p models
if [ ! -f models/ggml-medium.bin ]; then
  echo "→ whisper medium model (~1.5 GB)"
  curl -L --progress-bar -o models/ggml-medium.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
fi

echo
echo "Done. Gemma 4 12B (~7 GB) downloads automatically on first scripts/start-llm.sh run"
echo "(cached by llama.cpp under ~/Library/Caches/llama.cpp)."
