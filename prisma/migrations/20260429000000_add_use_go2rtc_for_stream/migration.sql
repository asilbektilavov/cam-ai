-- Camera: per-camera flag to route AI services through go2rtc proxy
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS "useGo2rtcForStream" BOOLEAN NOT NULL DEFAULT false;
