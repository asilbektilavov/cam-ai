'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Video, Eye, EyeOff, Chrome, Github, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

interface OAuthProviders {
  google: boolean;
  github: boolean;
  oidc: boolean;
  oidcName?: string;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [providers, setProviders] = useState<OAuthProviders | null>(null);

  // Fetch available OAuth providers on mount
  useEffect(() => {
    fetch('/api/auth/oauth-config')
      .then((res) => res.json())
      .then((data) => setProviders(data))
      .catch(() => setProviders({ google: false, github: false, oidc: false }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!email || !password) {
      toast.error('Заполните все поля');
      setLoading(false);
      return;
    }

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error || result?.ok === false) {
        toast.error('Неверный email или пароль');
        setLoading(false);
        return;
      }

      toast.success('Добро пожаловать!');
      window.location.href = '/dashboard';
    } catch {
      toast.error('Ошибка сервера. Попробуйте позже.');
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: string) => {
    setOauthLoading(provider);
    try {
      await signIn(provider, { callbackUrl: '/dashboard' });
    } catch {
      toast.error('Ошибка авторизации. Попробуйте позже.');
      setOauthLoading(null);
    }
  };

  const hasOAuth = providers && (providers.google || providers.github || providers.oidc);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-purple-500/10 blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative z-10">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
              <Video className="h-7 w-7 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl">Вход в CamAI</CardTitle>
          <CardDescription>
            Введите данные для доступа к платформе
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Введите пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Вход...' : 'Войти'}
            </Button>
          </form>

          {/* OAuth Divider & Buttons */}
          {hasOAuth && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">или</span>
                </div>
              </div>

              <div className="space-y-3">
                {providers.google && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!!oauthLoading}
                    onClick={() => handleOAuthSignIn('google')}
                  >
                    {oauthLoading === 'google' ? (
                      <span className="animate-spin mr-2 size-4 border-2 border-current border-t-transparent rounded-full" />
                    ) : (
                      <Chrome className="mr-2 h-4 w-4" />
                    )}
                    Войти через Google
                  </Button>
                )}

                {providers.github && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!!oauthLoading}
                    onClick={() => handleOAuthSignIn('github')}
                  >
                    {oauthLoading === 'github' ? (
                      <span className="animate-spin mr-2 size-4 border-2 border-current border-t-transparent rounded-full" />
                    ) : (
                      <Github className="mr-2 h-4 w-4" />
                    )}
                    Войти через GitHub
                  </Button>
                )}

                {providers.oidc && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!!oauthLoading}
                    onClick={() => handleOAuthSignIn('oidc')}
                  >
                    {oauthLoading === 'oidc' ? (
                      <span className="animate-spin mr-2 size-4 border-2 border-current border-t-transparent rounded-full" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}
                    Войти через {providers.oidcName || 'SSO'}
                  </Button>
                )}
              </div>
            </>
          )}

          <div className="mt-4 text-center text-sm text-muted-foreground">
            Нет аккаунта?{' '}
            <Link href="/register" className="text-primary hover:underline font-medium">
              Зарегистрироваться
            </Link>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
