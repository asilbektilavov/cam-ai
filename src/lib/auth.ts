import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from './prisma';
import { authRateLimiter } from './rate-limit';

// Static credentials — единственный способ входа
const STATIC_EMAIL = 'dss-admin@securitysystems.uz';
const STATIC_PASSWORD = 'DsS#2026!xKm9$vQr7Lp@3nW';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).toLowerCase();
        const rl = authRateLimiter.check(email);
        if (!rl.allowed) return null;

        // Check against static credentials
        if (email !== STATIC_EMAIL || credentials.password !== STATIC_PASSWORD) {
          return null;
        }

        // Find or create the admin user in DB
        let user = await prisma.user.findUnique({
          where: { email: STATIC_EMAIL },
          include: { organization: true },
        });

        if (!user) {
          let org = await prisma.organization.findFirst({
            where: { slug: 'dss-main' },
          });

          if (!org) {
            org = await prisma.organization.create({
              data: {
                name: 'Digital Security Systems',
                slug: 'dss-main',
              },
            });

            await prisma.branch.create({
              data: {
                name: 'Главный офис',
                organizationId: org.id,
              },
            });
          }

          user = await prisma.user.create({
            data: {
              email: STATIC_EMAIL,
              name: 'DSS Admin',
              passwordHash: '',
              role: 'admin',
              organizationId: org.id,
            },
            include: { organization: true },
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          organizationId: user.organizationId,
          organizationName: user.organization.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
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
