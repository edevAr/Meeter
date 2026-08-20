# AI Call Recorder

Mobile meeting assistant: record on your phone, transcribe with Whisper, and extract summaries, decisions and action items with AI.

```text
Phone mic → upload → Speech-to-Text → structured transcript → AI → summary / decisions / action items
```

## What is AI Call Recorder?

A **Flutter** mobile app, an **Angular** web agenda, and a **FastAPI** backend.

The phone and the web app record audio, then the backend transcribes with Whisper and extracts summaries, decisions and action items. The web app also keeps a digital agenda: yellow sticky notes plus day / week / month pending items.

## Architecture

```text
┌──────────────────────────────────────────────┐
│  Flutter mobile          Angular web (Meeter)│
│  Record · Library        Notes · Agenda · Live│
└──────────────────────┬───────────────────────┘
                       │ HTTPS / LAN / WS
                       ▼
┌──────────────────────────────────────────────┐
│              FastAPI backend                 │
│  Notes · Tasks · Recording · STT · AI        │
└───────────────┬──────────────┬───────────────┘
                ▼              ▼
           Whisper STT     LLM provider
                ▼
             SQLite
```

- **Mobile** — Flutter (iOS / Android). Microphone, playback, search, settings.
- **Web** — Angular + Tailwind. Sticky notes, agenda, live call transcription.
- **Application layer** — recordings, notes, tasks, transcription, AI.
- **Infrastructure** — SQLAlchemy, Whisper, LLM, exporters.
- **API** — FastAPI in Docker, consumed by the phone and `ng serve`.

## Features

- Record from the **phone microphone** with pause / resume / stop, timer and level meter
- History, playback, seek from transcript segments
- Local Whisper by default (audio stays on your backend unless you opt into cloud STT)
- Structured AI analysis (summary, topics, decisions, action items, participants)
- Global action-item inbox with filters
- Search across titles, transcripts, topics and tasks
- Export transcript / analysis (Markdown / JSON / TXT via the API)

## Recording on mobile vs “system audio”

On iOS and Android the supported source is the **microphone**. Apps cannot tap Zoom, Teams or Meet audio the way a virtual loopback device can on a desktop OS.

| Platform | What you can capture |
| --- | --- |
| **iOS** | Microphone (and whatever the user puts through the mic / speakerphone). No general system-audio tap. |
| **Android** | Microphone. Playback capture APIs are restricted and not used here. |

If you need a mix of both sides of a call, use speakerphone or a hardware splitter; do not expect silent interception of another app.

## Requirements

- **Docker Desktop** (or Docker Engine + Compose). This is enough to run the backend.
- **Flutter SDK** to run the mobile app (`flutter doctor`).
- Xcode (iOS) and/or Android Studio / an Android device (USB debugging).
- Optional: an OpenAI-compatible API key in `.env` for AI analysis.

## Installation

### Backend (Docker)

You do not need Python, ffmpeg or Whisper on your machine.

From the repo root, API + web in one command:

```bash
./start.sh
```

That starts the backend in Docker (`http://127.0.0.1:8001`) and the Angular app (`http://127.0.0.1:4200`). Ctrl+C stops the web; `docker compose stop` stops the API.

To run only the backend:

```bash
cp .env.example .env
# optional: put AI_API_KEY in .env if you want AI analysis
docker compose up --build
```

The API listens on `http://localhost:8001` (`GET /api/health`).

The container still uses port 8000 internally. Host port **8001** avoids clashing with other Docker projects that already bind 8000.

Recordings, the SQLite database and exports stay in `./data` on the host. The Whisper model is cached in a Docker volume so it is not downloaded on every restart.

Useful commands:

```bash
docker compose up --build -d    # background
docker compose logs -f api      # logs
docker compose down             # stop
```

From a phone on the same Wi-Fi, use your computer’s LAN IP: `http://192.168.x.x:8001`.

Local Ollama on the host (optional):

```text
AI_PROVIDER=ollama
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_MODEL=llama3.2
```

### Mobile app (Flutter)

```bash
cd mobile
flutter pub get
flutter devices
flutter run
```

Pick a connected iPhone, Android phone, simulator or emulator from `flutter devices`. The first iOS run may take a while while CocoaPods installs.

The app talks to the Mac LAN IP in `mobile/lib/api.dart` (`lanHost`, currently `http://192.168.0.31:8001`). Phone and computer must be on the same Wi-Fi. If the Mac IP changes, update `lanHost` and reinstall/hot-restart the app.

Cleartext HTTP to a LAN IP is allowed in this debug build (`NSAllowsArbitraryLoads` / `usesCleartextTraffic`). For production you would terminate TLS.

### Web app (Angular)

```bash
cd web
npm install
npm start
```

Open `http://localhost:4200`. The dev server proxies `/api` (including the live-transcript WebSocket) to `http://127.0.0.1:8001`.

- **Tablero** — yellow sticky notes, Enter to create
- **Pendientes** — today / week / month, complete and change priority
- **Grabar llamada** — live transcript while recording, then summary + notes
- **Llamadas** — history, transcribe, analyze, create notes from a call

`AI_API_KEY` is required for summaries. Whisper transcription is local.

## Configuration

See `.env.example`. Keys stay in the environment, never in SQLite, and are never sent to the phone (`GET /api/meta` only says whether a key is configured).

## App flow

```text
OPEN APP → Dashboard → Record → Stop → upload
        → Transcribe → transcript
        → Analyze with AI → summary, decisions, action items
```

Tabs: **Dashboard**, **Record**, **Recordings**, **Action Items**, **Settings**.

## API (mobile)

```text
POST   /api/recordings/upload
GET    /api/recordings/{id}/audio
GET    /api/dashboard
GET    /api/search?q=
GET    /api/meta
GET    /api/recordings/{id}/export/transcript?format=md
GET    /api/recordings/{id}/export/analysis?format=md
```

Plus the existing recordings, transcribe, analyze and action-item routes.

## Privacy

- Recording happens on the device; the file is uploaded only to **your** API
- Cloud STT requires `ALLOW_CLOUD_TRANSCRIPTION=true`
- Cloud LLM analysis asks for confirmation in the app before sending transcript text
- Delete is cascading (file + transcript + analysis + tasks) after confirmation

## Testing

From a checkout that has Python (contributors):

```bash
python -m pytest
```

The Docker image is a runtime image and does not include the test suite.

External Whisper and LLM calls are mocked in tests. Coverage includes mobile upload (`POST /api/recordings/upload`) and dashboard/meta.

Flutter client:

```bash
cd mobile
flutter test
```

## Future improvements

Connectors (Zoom / Teams / Meet), diarization, semantic search, task push to Jira/Linear, and cloud sync remain out of scope. The provider interfaces are unchanged.

## License

MIT
# Meeter
