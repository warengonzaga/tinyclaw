# @tinyclaw/plugin-provider-ollama

Ollama provider plugin for Tiny Claw. It supports both local Ollama instances and custom Ollama Cloud models while keeping the built-in starter models reserved for the built-in provider.

## What It Adds

- Local Ollama support with a configurable base URL
- Ollama Cloud support for custom cloud models
- Conversational pairing, model listing, and model switching tools
- Filtering of built-in cloud starter models from the plugin's cloud model list

## Conversational Tools

- `ollama_pair` - pair local or cloud Ollama
- `ollama_model_list` - show supported Ollama models for the current mode
- `ollama_model_set` - switch the configured Ollama model or mode
- `ollama_unpair` - disable the plugin and restore built-in routing

## Notes

- Cloud mode reuses the existing `provider.ollama.apiKey` from the built-in setup by default
- You only need to pass `apiKey` if you want to replace that stored Ollama key
- Cloud model listing excludes the built-in starter models
- Use `tinyclaw_restart` after pairing or switching models

## License

GPLv3
