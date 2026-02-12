import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { discoverCameras as scanNetwork } from '@/lib/services/network-scanner';
import { discoverCameras as onvifDiscover, getStreamUri } from '@/lib/services/onvif-manager';
import { checkPermission, RBACError } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface DiscoverResult {
  ip: string;
  ports: number[];
  protocol: 'rtsp' | 'http' | 'unknown';
  suggestedUrl: string;
  brand?: string;
  name: string;
  manufacturer?: string;
  model?: string;
  onvifSupported: boolean;
  alreadyAdded: boolean;
  existingCameraId?: string;
}

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const url = new URL(req.url);
  const credParam = url.searchParams.get('credentials');
  let username: string | undefined;
  let password: string | undefined;
  if (credParam && credParam.includes(':')) {
    [username, password] = credParam.split(':', 2);
  }

  try {
    // Run both scans in parallel
    const [portResults, onvifResults] = await Promise.allSettled([
      scanNetwork(),
      onvifDiscover(4000),
    ]);

    const portCameras = portResults.status === 'fulfilled' ? portResults.value : [];
    const onvifCameras = onvifResults.status === 'fulfilled' ? onvifResults.value : [];

    // Merge by IP — ONVIF enriches port-scan results
    const merged = new Map<string, DiscoverResult>();

    for (const cam of portCameras) {
      merged.set(cam.ip, {
        ip: cam.ip,
        ports: cam.ports,
        protocol: cam.protocol,
        suggestedUrl: cam.suggestedUrl,
        brand: cam.brand,
        name: cam.brand || cam.name || 'Камера',
        onvifSupported: false,
        alreadyAdded: false,
      });
    }

    for (const dev of onvifCameras) {
      const existing = merged.get(dev.address);
      if (existing) {
        existing.onvifSupported = true;
        existing.manufacturer = dev.manufacturer || undefined;
        existing.model = dev.model || undefined;
        existing.name = dev.name || dev.manufacturer || existing.name;
        if (dev.streamUri) existing.suggestedUrl = dev.streamUri;
      } else {
        merged.set(dev.address, {
          ip: dev.address,
          ports: [dev.port, 554],
          protocol: 'rtsp',
          suggestedUrl: dev.streamUri,
          name: dev.name || 'ONVIF Камера',
          manufacturer: dev.manufacturer || undefined,
          model: dev.model || undefined,
          onvifSupported: true,
          alreadyAdded: false,
        });
      }
    }

    // Resolve actual ONVIF stream URIs if credentials provided
    if (username && password) {
      const onvifDevices = [...merged.values()].filter((d) => d.onvifSupported);
      await Promise.allSettled(
        onvifDevices.map(async (dev) => {
          try {
            const uri = await getStreamUri(dev.ip, 80, username, password);
            dev.suggestedUrl = uri;
          } catch {
            // keep existing suggestedUrl
          }
        })
      );
    }

    // Check which IPs are already added
    const orgId = (session.user as { organizationId?: string }).organizationId;
    if (orgId) {
      const existingCameras = await prisma.camera.findMany({
        where: { organizationId: orgId },
        select: { id: true, streamUrl: true },
      });

      const existingIpMap = new Map<string, string>();
      for (const cam of existingCameras) {
        try {
          const urlObj = new URL(cam.streamUrl);
          existingIpMap.set(urlObj.hostname, cam.id);
        } catch {
          const match = cam.streamUrl.match(/@?([\d.]+)[:/]/);
          if (match) existingIpMap.set(match[1], cam.id);
        }
      }

      for (const dev of merged.values()) {
        const camId = existingIpMap.get(dev.ip);
        if (camId) {
          dev.alreadyAdded = true;
          dev.existingCameraId = camId;
        }
      }
    }

    // Sort: not-added first, then by IP
    const results = [...merged.values()].sort((a, b) => {
      if (a.alreadyAdded !== b.alreadyAdded) return a.alreadyAdded ? 1 : -1;
      return a.ip.localeCompare(b.ip, undefined, { numeric: true });
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error('Camera discovery error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
