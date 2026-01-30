import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      organizationId: string;
      organizationName: string;
      role: string;
    };
  }

  interface User {
    organizationId?: string;
    organizationName?: string;
    role?: string;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    organizationId?: string;
    organizationName?: string;
    role?: string;
  }
}
