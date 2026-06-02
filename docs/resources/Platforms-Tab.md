# Platforms Tab

**Status:** Implemented (Sprint 8)

## Overview
A centralized hub for quick access to 3rd party task schedulers and custom automation interfaces.

## Features
- **Official Schedulers:** Dedicated, full-width rows for:
    - [Claude Routines](https://claude.ai/code/routines)
    - [ChatGPT Schedules](https://chatgpt.com/schedules)
    - [Gemini Scheduled](https://gemini.google.com/scheduled)
- **Custom Links:** 
    - Users can manually add custom links (e.g., N8N, OpenClaw, Hermes).
    - Custom links appear in a separate "User Defined" section.
    - Delete functionality for custom entries via hover action.
- **Persistence:** All custom links are persisted locally via `localStorage`.
- **UI Design:** Clean, dark-themed rectangular boxes with lead icons (Bot, Sparkles, Globe, etc.).

## Future Enhancements
- Server-side persistence for platform links.
- Integration with platform-specific APIs for health monitoring.
- Drag-and-drop reordering.
