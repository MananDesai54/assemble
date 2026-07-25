#!/bin/zsh
# Local LLM: Gemma 4 12B via llama-server (OpenAI-compatible API on :4820).
# First run downloads the GGUF (~7 GB) into llama.cpp's cache.
exec llama-server \
  -hf unsloth/gemma-4-12b-it-GGUF:Q4_K_M \
  --port "${ASSEMBLE_LLM_PORT:-4820}" \
  -ngl 99 \
  -c 8192 \
  --jinja
