import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { authRateLimiter } from './rate-limit';

// Build providers list dynamically based on available env vars
const providers: NextAuthConfig['providers'] = [];

// Google OAuth — only enabled when env vars are set
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

// GitHub OAuth — only enabled when env vars are set
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  );
}

// Generic OIDC provider — only enabled when env vars are set
if (
  process.env.OIDC_CLIENT_ID &&
  process.env.OIDC_CLIENT_SECRET &&
  process.env.OIDC_ISSUER
) {
  providers.push({
    id: 'oidc',
    name: process.env.OIDC_PROVIDER_NAME || 'Corporate SSO',
    type: 'oidc' as const,
    issuer: process.env.OIDC_ISSUER,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
  });
}

// Credentials provider — always available
providers.push(
  Credentials({
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials, request) {
      if (!credentials?.email || !credentials?.password) return null;

      // Rate limit by email to prevent brute-force
      const email = (credentials.email as string).toLowerCase();
      const rl = authRateLimiter.check(email);
      if (!rl.allowed) return null;

      const user = await prisma.user.findUnique({
        where: { email: credentials.email as string },
        include: { organization: true },
      });

      if (!user) return null;

      const isValid = await bcrypt.compare(
        credentials.password as string,
        user.passwordHash
      );

      if (!isValid) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
        role: user.role,
      };
    },
  })
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  callbacks: {
    async signIn({ user, account }) {
      // For OAuth providers, find or create the user record in our DB
      if (account && account.provider !== 'credentials') {
        const email = user.email;
        if (!email) return false;

        let dbUser = await prisma.user.findUnique({
          where: { email },
          include: { organization: true },
        });

        if (!dbUser) {
          // Auto-create user for OAuth: create a personal org or assign to default
          let org = await prisma.organization.findFirst({
            where: { slug: 'default' },
          });

          if (!org) {
            org = await prisma.organization.create({
              data: {
                name: 'Default Organization',
                slug: 'default',
              },
            });
          }

          dbUser = await prisma.user.create({
            data: {
              email,
              name: user.name || email.split('@')[0],
              passwordHash: '', // OAuth users have no password
              role: 'admin',
              organizationId: org.id,
            },
            include: { organization: true },
          });
        }

        // Attach DB fields to the user object for jwt callback
        (user as Record<string, unknown>).id = dbUser.id;
        (user as Record<string, unknown>).organizationId = dbUser.organizationId;
        (user as Record<string, unknown>).organizationName = dbUser.organization.name;
        (user as Record<string, unknown>).role = dbUser.role;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as Record<string, unknown>).id as string;
        token.organizationId = (user as Record<string, unknown>).organizationId as string;
        token.organizationName = (user as Record<string, unknown>).organizationName as string;
        token.role = (user as Record<string, unknown>).role as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = session.user as any;
        user.id = token.id || token.sub;
        user.organizationId = token.organizationId;
        user.organizationName = token.organizationName;
        user.role = token.role;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: { strategy: 'jwt' },
  trustHost: true,
});
