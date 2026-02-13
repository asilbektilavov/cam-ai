# CamAI - Video Surveillance Analytics Platform

## Project Overview
CamAI is a web-based video surveillance analytics platform that uses AI to analyze camera feeds for various types of establishments (retail, restaurants, warehouses, offices, banks, parking lots). The platform provides real-time analytics, alerts, and integrations with third-party services.

## Tech Stack
- **Framework**: Next.js 15 (App Router) with TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Icons**: Lucide React
- **State Management**: Zustand
- **Theme**: next-themes (dark/light mode support)
- **Notifications**: Sonner (toast notifications)

## Project Structure
```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/             # Auth group (login, register)
│   ├── (dashboard)/        # Dashboard group (requires auth)
│   │   ├── select-venue/   # Venue type selection
│   │   ├── dashboard/      # Main analytics dashboard
│   │   ├── cameras/        # Camera management
│   │   ├── analytics/      # Detailed analytics
│   │   ├── integrations/   # Third-party integrations
│   │   └── settings/       # User settings
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Landing page
│   └── globals.css         # Global styles
├── components/
│   ├── ui/                 # shadcn/ui components
│   ├── auth/               # Auth-related components
│   ├── dashboard/          # Dashboard components
│   └── layout/             # Layout components (sidebar, header)
├── lib/
│   ├── utils.ts            # Utility functions
│   ├── store.ts            # Zustand store
│   └── types.ts            # TypeScript types
└── hooks/                  # Custom React hooks
```

## Commands
- `npm run dev` - Start development server (localhost:3000)
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm start` - Start production server

## Key Features
1. **Authentication** - Login/Register with email & password
2. **Venue Selection** - Choose establishment type (retail, restaurant, warehouse, office, bank, parking)
3. **AI Analytics Dashboard** - Real-time camera feed analysis
4. **Camera Management** - Add, configure, and manage cameras
5. **Analytics Reports** - Detailed reports and statistics
6. **Integrations** - Telegram, Slack, Email, Webhooks, 1C, Bitrix24
7. **Dark/Light Theme** - Full theme support

## AI Analysis Features by Venue Type
- **Retail**: People counting, heatmaps, theft detection, queue management
- **Restaurant**: Table occupancy, wait times, hygiene monitoring
- **Warehouse**: Safety compliance, inventory tracking, restricted area access
- **Office**: Attendance tracking, room utilization, security alerts
- **Bank**: Suspicious behavior, ATM monitoring, queue analysis
- **Parking**: License plate recognition, space occupancy, traffic flow

## Services

### Next.js App (port 3000)
Main web app — dashboard, camera management, analytics, attendance UI.

### go2rtc (port 1984/8554/8555)
Low-latency video streaming: RTSP → WebRTC in browser (<500ms). Binary in `bin/go2rtc`.

### detection-service (port 8001)
Python FastAPI + YOLOv8n. Server-side object detection at ~1fps.

### attendance-service (port 8002)
Python FastAPI + face_recognition (dlib CNN). Autonomous face recognition:
- Runs independently — records attendance even when browser is closed
- Watches cameras via RTSP/HTTP, detects faces at ~1.3fps
- Matches against known employees (synced from Next.js API)
- Records check-in/check-out to DB via POST `/api/attendance/event` (5min cooldown per person)
- Pushes face overlay data to POST `/api/attendance/face-events` (browser reads via polling)

**Employee sync**: attendance-service loads employees on startup. Auto-sync triggers when employees are created/updated/deleted via the web UI (POST/PATCH/DELETE on employee routes call `/employees/sync`).

**Start**: `cd attendance-service && python main.py` (or uvicorn)

## Attendance / Face Recognition Architecture

### Detection Pipeline
1. **Browser ONNX UltraFace** (~24fps): Fast face bbox tracking in browser
2. **Server dlib CNN** (~1.3fps): Face identity (name + confidence) via attendance-service
3. **Merge logic** (camera page `useMemo`): Browser bbox (fast position) + Server identity (name/color) matched by center distance (threshold 0.25)

### Data Flow (overlay)
```
attendance-service → POST /api/attendance/face-events → process-level cache
browser polls GET /api/attendance/face-events?cameraId=... every 500ms → merge with browser faces → DetectionOverlay canvas
```
Polling only runs when camera page is open (useEffect cleanup stops it).

### Data Flow (attendance records)
```
attendance-service → _report_event() → POST /api/attendance/event → Prisma AttendanceRecord
```
Works autonomously without browser. 5-minute cooldown per (employee, camera).

### Key Files
- `attendance-service/main.py` — FrameGrabber, CameraWatcher, face matching
- `src/app/api/attendance/face-events/route.ts` — process-level cache + polling GET endpoint
- `src/app/api/attendance/event/route.ts` — attendance record creation
- `src/app/api/attendance/employees/route.ts` — employee CRUD + auto-sync to attendance-service
- `src/hooks/use-browser-face-detection.ts` — browser ONNX UltraFace detection
- `src/components/detection-overlay.tsx` — canvas overlay (rAF loop, detectionsRef)

### Singleton Pattern (Turbopack HMR)
Use `process` as singleton container, NOT `globalThis`. Turbopack creates separate module contexts during HMR, breaking `globalThis` singletons. See `src/lib/services/event-emitter.ts` and face-events route.

## Development Notes
- All UI components are from shadcn/ui (in `src/components/ui/`)
- Use `cn()` from `@/lib/utils` for conditional class names
- Auth state is managed via Zustand store (`@/lib/store`)
- The app uses route groups: `(auth)` for public auth pages, `(dashboard)` for protected pages
- Russian language is used for UI text (target audience)
- **Singletons**: Always use `process[KEY]` pattern for module-level singletons that need to survive Turbopack HMR
