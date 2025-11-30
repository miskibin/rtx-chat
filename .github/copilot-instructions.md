# Copilot Instructions

## Code Style
1. Don't write try-except blocks. Don't handle edge cases.
2. Don't write documentation or comments.
3. Use f-strings for formatting strings.
4. Use typing from builtins (list, dict, tuple, etc.) not from Typing module.
5. Keep code AS SHORT AS POSSIBLE. Avoid unnecessary variables, functions, classes.

## Tools & Setup
6. Use `uv` for package management:
  - Run scripts: `uv run <filename>`
  - Install packages: `uv add <package-name>`

## AI & LLM
7. Use only Ollama with langchain
  - Embeddings: `embeddinggemma` model
  - Chat: `qwen3:4b` model

## Logging
8. Use loguru with DEFAULT handler for logging.

use langchain mcp for getting docs.