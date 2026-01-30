'use client';

import { useState } from 'react';
import {
  User,
  Bell,
  Shield,
  Palette,
  Globe,
  Save,
  Camera,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { data: session } = useSession();

  // Profile
  const [name, setName] = useState(session?.user?.name || '');
  const [email, setEmail] = useState(session?.user?.email || '');
  const [company, setCompany] = useState('');

  // Security
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [twoFA, setTwoFA] = useState(false);
  const [ipRestriction, setIpRestriction] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState({
    critical: true,
    warnings: true,
    info: false,
    system: true,
    dailyReport: false,
    weeklyReport: true,
  });

  // System
  const [language, setLanguage] = useState('ru');
  const [timezone, setTimezone] = useState('utc+5');
  const [autoRecord, setAutoRecord] = useState(true);
  const [cloudStorage, setCloudStorage] = useState(true);
  const [aiQuality, setAiQuality] = useState('high');

  const handleSaveProfile = () => {
    if (!name || !email) {
      toast.error('Имя и email обязательны');
      return;
    }
    toast.success('Профиль обновлён');
  };

  const handleSaveNotifications = () => {
    toast.success('Настройки уведомлений сохранены');
  };

  const handleChangePassword = () => {
    if (!currentPassword) {
      toast.error('Введите текущий пароль');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Пароль должен содержать минимум 6 символов');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    toast.success('Пароль изменён');
  };

  const handleSaveSystem = () => {
    toast.success('Системные настройки сохранены');
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-muted-foreground">Управление аккаунтом и настройками системы</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4" />
            Профиль
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            Уведомления
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            Безопасность
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-2">
            <Palette className="h-4 w-4" />
            Система
          </TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Профиль</CardTitle>
              <CardDescription>Информация о вашем аккаунте</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="profile-name">Имя</Label>
                  <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile-email">Email</Label>
                  <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile-company">Компания</Label>
                  <Input
                    id="profile-company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Название компании"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Роль</Label>
                  <Input value="Администратор" disabled />
                </div>
              </div>
              <Button onClick={handleSaveProfile} className="gap-2">
                <Save className="h-4 w-4" />
                Сохранить изменения
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Настройки уведомлений</CardTitle>
              <CardDescription>Выберите, о каких событиях вы хотите получать уведомления</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {[
                {
                  key: 'critical' as const,
                  title: 'Критические события',
                  description: 'Подозрительное поведение, нарушения безопасности',
                },
                {
                  key: 'warnings' as const,
                  title: 'Предупреждения',
                  description: 'Длинные очереди, камеры офлайн, нетипичная активность',
                },
                {
                  key: 'info' as const,
                  title: 'Информационные',
                  description: 'Подсчёт посетителей, распознавание номеров, VIP-клиенты',
                },
                {
                  key: 'system' as const,
                  title: 'Системные',
                  description: 'Обновления, обслуживание, отчёты',
                },
                {
                  key: 'dailyReport' as const,
                  title: 'Ежедневный отчёт',
                  description: 'Сводка за день на email в 22:00',
                },
                {
                  key: 'weeklyReport' as const,
                  title: 'Еженедельный отчёт',
                  description: 'Подробный отчёт каждый понедельник',
                },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <Switch
                    checked={notifications[item.key]}
                    onCheckedChange={(checked) =>
                      setNotifications((prev) => ({ ...prev, [item.key]: checked }))
                    }
                  />
                </div>
              ))}
              <Separator />
              <Button onClick={handleSaveNotifications} className="gap-2">
                <Save className="h-4 w-4" />
                Сохранить
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Безопасность</CardTitle>
              <CardDescription>Настройки безопасности аккаунта</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cur-pass">Текущий пароль</Label>
                  <div className="relative">
                    <Input
                      id="cur-pass"
                      type={showPasswords ? 'text' : 'password'}
                      placeholder="Введите текущий пароль"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-pass">Новый пароль</Label>
                  <Input
                    id="new-pass"
                    type={showPasswords ? 'text' : 'password'}
                    placeholder="Минимум 6 символов"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-pass">Подтвердите пароль</Label>
                  <Input
                    id="confirm-new-pass"
                    type={showPasswords ? 'text' : 'password'}
                    placeholder="Повторите новый пароль"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {showPasswords ? 'Скрыть пароли' : 'Показать пароли'}
                  </span>
                </div>
                <Button onClick={handleChangePassword} variant="outline" className="gap-2">
                  Изменить пароль
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Двухфакторная аутентификация</p>
                  <p className="text-sm text-muted-foreground">
                    Дополнительная защита через SMS или приложение
                  </p>
                </div>
                <Switch
                  checked={twoFA}
                  onCheckedChange={(checked) => {
                    setTwoFA(checked);
                    toast.success(checked ? '2FA включена' : '2FA отключена');
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Вход по IP</p>
                  <p className="text-sm text-muted-foreground">
                    Ограничить доступ только с доверенных IP-адресов
                  </p>
                </div>
                <Switch
                  checked={ipRestriction}
                  onCheckedChange={(checked) => {
                    setIpRestriction(checked);
                    toast.success(checked ? 'Ограничение по IP включено' : 'Ограничение по IP отключено');
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System */}
        <TabsContent value="system">
          <Card>
            <CardHeader>
              <CardTitle>Системные настройки</CardTitle>
              <CardDescription>Общие параметры системы</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Язык интерфейса</Label>
                  <Select value={language} onValueChange={(v) => { setLanguage(v); toast.info('Язык будет изменён после перезагрузки'); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ru">Русский</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="uz">O&apos;zbek</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Часовой пояс</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utc+3">Москва (UTC+3)</SelectItem>
                      <SelectItem value="utc+5">Ташкент (UTC+5)</SelectItem>
                      <SelectItem value="utc+6">Алматы (UTC+6)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Camera className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Автозапись</p>
                      <p className="text-sm text-muted-foreground">Автоматическая запись при детекции</p>
                    </div>
                  </div>
                  <Switch checked={autoRecord} onCheckedChange={setAutoRecord} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Globe className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Облачное хранение</p>
                      <p className="text-sm text-muted-foreground">Сохранять записи в облако</p>
                    </div>
                  </div>
                  <Switch checked={cloudStorage} onCheckedChange={setCloudStorage} />
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Качество ИИ-анализа</Label>
                <Select value={aiQuality} onValueChange={setAiQuality}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Экономный (быстрее, менее точно)</SelectItem>
                    <SelectItem value="medium">Средний (баланс скорости и точности)</SelectItem>
                    <SelectItem value="high">Высокий (максимальная точность)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSaveSystem} className="gap-2">
                <Save className="h-4 w-4" />
                Сохранить
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
