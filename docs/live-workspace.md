# Live workspace: current implementation brief

User-confirmed scope (11 September 2026): an owned room inside Soyle/Aimeet, **voice only, no video**, started with one action and shared by invite link. Two exclusive content modes: Conversation (speaker-attributed live transcript) and Outcomes (goals, ideas, decisions, tasks, open questions). Do not show a transcript and outcomes side by side. Use a compact participant strip and few controls. Existing archive and file transcription remain available.

Audio recognition must run locally. The user explicitly allows sending **text only** to OpenAI for live analysis. Meeting participants must see this processing boundary before joining. Generated design sample people and notes are never runtime fixtures.

Design: Art-Direct ImageGen FULL lifecycle. First concurrent video composition rejected. Replacement voice-only outcomes mockup is in `.frontend-workbench/sessions/soyle-live-voice/`; bitmap review passed, exact user acceptance is pending. The existing Soyle logo stays authoritative. No live implementation exists yet at the time this brief was written.

Planned architecture: self-hosted LiveKit for actual multi-party audio, existing FastAPI for room ownership/invites/session grants, and PostgreSQL for retained utterances and cited insights. Each participant's published microphone track also feeds a local PCM transcription stream, so the transcriber attributes speech to the authenticated room participant without guessing voices. A persistent local Faster-Whisper worker processes bounded speech chunks; an independent text-analysis worker uses OpenAI. Loss of audio or analysis connectivity is represented truthfully. Ending a room blocks new joins and eventually preserves finalized content in the archive. Media and ASR use separate connections to avoid container ICE advertisement assumptions.

Local acceptance must include two separate browser participants actually exchanging audio, live transcript attribution, mic mute/leave/end, invitation boundaries, reconnect/processing failure states, analysis citing only provided utterances, persistence, responsive modes, and preservation of existing archive tests. Localhost proof does not establish remote calling: remote deployment requires trusted HTTPS/WSS and externally reachable LiveKit media/TURN configuration.

## Running live processing

Live needs both `live-speech-worker` (local audio recognition) and `live-analysis-worker` (text analysis and room finalization), in addition to API and LiveKit. A healthy API and a working microphone do not establish that speech is being processed. The web service depends on both workers so a normal `docker compose up -d web` starts them too. Deployments using `--no-deps` must start these workers explicitly:

```sh
docker compose up -d --no-deps live-speech-worker live-analysis-worker
docker compose ps live-speech-worker live-analysis-worker
```

Speech arrives in phrases, not individual tokens: a pause of roughly 0.6 seconds flushes a phrase, and continuous speech is split into chunks of at most roughly 8 seconds. Recognition time and the 1.5-second room polling interval add latency. Queued audio with no running speech worker will not produce a transcript. Temporary history-request failures retry automatically with backoff; permission failures require restoring room access.
