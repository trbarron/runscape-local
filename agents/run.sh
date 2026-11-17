#!/bin/bash
# Interactive entry point. For persistence across terminal/tool exits use:
# bun agents/service.ts install
cd "$(dirname "$0")/.." || exit 1
exec bun agents/supervisor.ts
