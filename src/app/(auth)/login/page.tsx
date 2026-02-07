'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Video, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!email || !password) {
      toast.error('Заполните все поля');
      setLoading(false);
      return;
    }

    if (needs2FA && !totpCode) {
      toast.error('Введите код из приложения');
      setLoading(false);
      return;
    }

    const result = await signIn('credentials', {
      email,
      password,
      totpCode: needs2FA ? totpCode : '',
      redirect: false,
    });

    if (result?.error) {
      if (result.error.includes('2FA_REQUIRED')) {
        setNeeds2FA(true);
        setTotpCode('');
        toast.info('Введите код из Google Authenticator');
      } else if (result.error.includes('INVALID_2FA_CODE')) {
        toast.error('Неверный код 2FA');
        setTotpCode('');
      } else {
        toast.error('Неверный email или пароль');
      }
    } else {
      toast.success('Добро пожаловать!');
      router.push('/select-venue');
    }
    setLoading(false);
  };

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
            {needs2FA ? 'Введите код двухфакторной аутентификации' : 'Введите данные для доступа к платформе'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!needs2FA ? (
              <>
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
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10">
                    <ShieldCheck className="h-8 w-8 text-blue-500" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totpCode">Код из Google Authenticator</Label>
                  <Input
                    id="totpCode"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="text-center text-2xl tracking-[0.5em] font-mono"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setNeeds2FA(false); setTotpCode(''); }}
                  className="text-sm text-muted-foreground hover:text-foreground w-full text-center"
                >
                  Назад к входу
                </button>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Вход...' : needs2FA ? 'Подтвердить' : 'Войти'}
            </Button>
          </form>

          {!needs2FA && (
            <>
              <div className="mt-3 text-center">
                <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">
                  Забыли пароль?
                </Link>
              </div>

              <div className="mt-3 text-center text-sm text-muted-foreground">
                Нет аккаунта?{' '}
                <Link href="/register" className="text-primary hover:underline font-medium">
                  Зарегистрироваться
                </Link>
              </div>
            </>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
