import { prisma } from '@/lib/prisma';

const keyCache = new Map<string, { key: string | null; expiry: number }>();
const CACHE_TTL = 60_000; // 1 minute

/**
 * Get Gemini API key for an organization.
 * Priority: org.geminiApiKey (from DB) → process.env.GEMINI_API_KEY
 */
export async function getGeminiApiKey(orgId: string): Promise<string | null> {
  const now = Date.now();
  const cached = keyCache.get(orgId);
  if (cached && cached.expiry > now) {
    return cached.key;
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { geminiApiKey: true },
    });

    const key = org?.geminiApiKey || process.env.GEMINI_API_KEY || null;
    keyCache.set(orgId, { key, expiry: now + CACHE_TTL });
    return key;
  } catch {
    return process.env.GEMINI_API_KEY || null;
  }
}

/** Clear cached key (call after user updates their key) */
export function clearGeminiKeyCache(orgId: string) {
  keyCache.delete(orgId);
}
