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

## Development Notes
- All UI components are from shadcn/ui (in `src/components/ui/`)
- Use `cn()` from `@/lib/utils` for conditional class names
- Auth state is managed via Zustand store (`@/lib/store`)
- The app uses route groups: `(auth)` for public auth pages, `(dashboard)` for protected pages
- Russian language is used for UI text (target audience)
