import { handlers } from '@/lib/auth';

// IMPORTANT: Do NOT wrap handlers.POST in a custom function.
// NextAuth v5 (Auth.js) sets session cookies via internal Next.js mechanisms
// that break when the handler is wrapped. Rate limiting is done inside
// the authorize callback in auth.ts instead.
export const { GET, POST } = handlers;
