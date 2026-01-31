'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Rocket,
  Server,
  Terminal,
  Camera,
  Brain,
  Bell,
  PartyPopper,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  CheckCircle2,
  Copy,
  Cpu,
  HardDrive,
  Monitor,
  Wifi,
  Globe,
  Users,
  Timer,
  ScanFace,
  MessageCircle,
  Webhook,
  LayoutDashboard,
  BarChart3,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface OnboardingStep {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const steps: OnboardingStep[] = [
  { id: 'welcome', title: 'Добро пожаловать', subtitle: 'Знакомство с CamAI', icon: Rocket, iconColor: 'text-blue-500', iconBg: 'bg-blue-500/10' },
  { id: 'requirements', title: 'Системные требования', subtitle: 'Что нужно для работы', icon: Server, iconColor: 'text-orange-500', iconBg: 'bg-orange-500/10' },
  { id: 'installation', title: 'Установка', subtitle: 'Запуск CamAI на сервере', icon: Terminal, iconColor: 'text-green-500', iconBg: 'bg-green-500/10' },
  { id: 'cameras', title: 'Подключение камер', subtitle: 'Настройка видеопотоков', icon: Camera, iconColor: 'text-purple-500', iconBg: 'bg-purple-500/10' },
  { id: 'features', title: 'Умные функции', subtitle: 'ИИ-аналитика для бизнеса', icon: Brain, iconColor: 'text-cyan-500', iconBg: 'bg-cyan-500/10' },
  { id: 'notifications', title: 'Уведомления', subtitle: 'Telegram, вебхуки, интеграции', icon: Bell, iconColor: 'text-yellow-500', iconBg: 'bg-yellow-500/10' },
  { id: 'done', title: 'Готово!', subtitle: 'Вы готовы к работе', icon: PartyPopper, iconColor: 'text-emerald-500', iconBg: 'bg-emerald-500/10' },
];

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative group">
      <pre className="rounded-lg bg-muted/50 border p-4 font-mono text-sm overflow-x-auto">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => {
          navigator.clipboard.writeText(code);
          toast.success('Скопировано');
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CmdItem({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-mono">{cmd}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(cmd);
          toast.success('Скопировано');
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Step content renderers ─────────────────────────────────────────────

function StepWelcome() {
  const features = [
    { icon: Camera, title: 'Подключение камер', desc: 'Поддержка Hikvision, Dahua, Trassir и IP Webcam' },
    { icon: Brain, title: 'ИИ-анализ', desc: 'Распознавание людей, очередей, подозрительного поведения' },
    { icon: Bell, title: 'Уведомления', desc: 'Мгновенные оповещения в Telegram и по вебхуку' },
    { icon: BarChart3, title: 'Аналитика', desc: 'Детальная статистика и отчёты для бизнеса' },
  ];

  return (
    <div className="space-y-8">
      <div className="text-center py-6">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600">
          <Video className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold mb-3">Добро пожаловать в CamAI</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          CamAI — это ИИ-платформа для видеонаблюдения, которая превращает ваши камеры
          в интеллектуальную систему безопасности и аналитики.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {features.map((f) => (
          <div key={f.title} className="flex items-start gap-3 rounded-lg border p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <f.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRequirements() {
  const hardware = [
    { icon: Cpu, label: 'Процессор', value: 'Intel i5 / AMD Ryzen 5 или выше' },
    { icon: HardDrive, label: 'Оперативная память', value: '8 ГБ RAM (рекомендуется 16 ГБ)' },
    { icon: HardDrive, label: 'Диск', value: 'SSD 256 ГБ+' },
    { icon: Monitor, label: 'ОС', value: 'Ubuntu 22.04+ / Debian 12+' },
  ];

  const network = [
    { icon: Wifi, text: 'Мини-ПК и камеры должны быть в одной локальной сети' },
    { icon: Wifi, text: 'Рекомендуется проводное подключение (Ethernet)' },
    { icon: Globe, text: 'Доступ в интернет для ИИ-анализа (Gemini API)' },
  ];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        CamAI разворачивается на мини-ПК в вашей локальной сети через Docker.
      </p>

      <div>
        <h3 className="font-semibold mb-3">Мини-ПК (минимальные характеристики)</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {hardware.map((item) => (
            <div key={item.label} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Сеть</h3>
        <div className="space-y-2">
          {network.map((item) => (
            <div key={item.text} className="flex items-center gap-3 rounded-lg border p-3">
              <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Программное обеспечение</h3>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Docker</Badge>
            <span className="text-sm text-muted-foreground">v20.10+ с Docker Compose</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Docker будет установлен автоматически при запуске install.sh, если не найден.
          </p>
        </div>
      </div>
    </div>
  );
}

function StepInstallation() {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Выполните следующие команды на мини-ПК для установки CamAI.
      </p>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">1</Badge>
          Скачайте CamAI
        </h3>
        <CodeBlock code="git clone https://github.com/asilbektilavov/cam-ai.git && cd cam-ai" />
      </div>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">2</Badge>
          Запустите установщик
        </h3>
        <CodeBlock code="chmod +x install.sh && ./install.sh" />
        <p className="text-xs text-muted-foreground mt-2">
          Скрипт проверит Docker, запросит Gemini API ключ и запустит сервис.
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">3</Badge>
          Откройте в браузере
        </h3>
        <CodeBlock code="http://localhost:3000" />
        <p className="text-xs text-muted-foreground mt-2">
          Зарегистрируйте первый аккаунт — он станет администратором.
        </p>
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold mb-3">Полезные команды</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <CmdItem label="Остановить" cmd="docker compose down" />
          <CmdItem label="Запустить" cmd="docker compose up -d" />
          <CmdItem label="Посмотреть логи" cmd="docker compose logs -f" />
          <CmdItem label="Обновить" cmd="./update.sh" />
        </div>
      </div>
    </div>
  );
}

function StepCameras() {
  const brands = [
    {
      brand: 'Hikvision',
      url: 'rtsp://admin:password@192.168.1.64:554/Streaming/Channels/101',
      note: 'Канал 101 = основной поток, 102 = субпоток',
      color: 'text-red-400',
    },
    {
      brand: 'Dahua',
      url: 'rtsp://admin:password@192.168.1.64:554/cam/realmonitor?channel=1&subtype=0',
      note: 'subtype=0 основной, subtype=1 субпоток',
      color: 'text-blue-400',
    },
    {
      brand: 'Trassir',
      url: 'rtsp://admin:password@192.168.1.64:554/live/main',
      note: 'main = основной поток, sub = субпоток',
      color: 'text-green-400',
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        CamAI поддерживает IP-камеры по протоколу RTSP и приложение IP Webcam для Android.
      </p>

      <div>
        <h3 className="font-semibold mb-3">Как узнать IP-адрес камеры</h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p>1. Откройте веб-интерфейс роутера (обычно 192.168.1.1)</p>
          <p>2. Найдите список подключённых устройств (DHCP Clients)</p>
          <p>3. Найдите камеру по имени (Hikvision, Dahua и т.д.)</p>
          <p className="text-muted-foreground text-xs mt-2">
            Альтернатива: используйте утилиту <code className="bg-muted px-1 py-0.5 rounded">nmap -sP 192.168.1.0/24</code> для сканирования сети.
          </p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Шаблоны RTSP URL</h3>
        <div className="space-y-3">
          {brands.map((item) => (
            <div key={item.brand} className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className={item.color}>{item.brand}</Badge>
              </div>
              <CodeBlock code={item.url} />
              <p className="text-xs text-muted-foreground mt-2">{item.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">IP Webcam (Android)</h3>
        <div className="rounded-lg border p-4 text-sm space-y-1">
          <p>1. Установите приложение «IP Webcam» из Google Play</p>
          <p>2. Запустите сервер в приложении</p>
          <p>3. Используйте URL: <code className="bg-muted px-1.5 py-0.5 rounded">http://192.168.1.X:8080</code></p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
        <p className="text-sm font-medium flex items-center gap-2">
          <Camera className="h-4 w-4 text-blue-500" />
          Проверка подключения
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          После добавления камеры нажмите кнопку проверки подключения для тестирования потока.
          Перейдите на страницу «Камеры» для добавления.
        </p>
      </div>
    </div>
  );
}

function StepFeatures() {
  const features = [
    {
      icon: Users,
      title: 'Контроль очередей',
      description: 'Подсчёт людей в очереди и уведомление при превышении порога. Идеально для магазинов и банков.',
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      icon: ScanFace,
      title: 'Поиск человека',
      description: 'Загрузите фото — система найдёт этого человека на всех камерах в реальном времени.',
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    },
    {
      icon: Timer,
      title: 'Детекция праздношатания',
      description: 'Обнаружение людей, которые находятся в одной зоне слишком долго. Для безопасности территории.',
      color: 'text-orange-500',
      bg: 'bg-orange-500/10',
    },
    {
      icon: Monitor,
      title: 'Контроль рабочей зоны',
      description: 'Уведомление если рабочее место пустует дольше заданного времени. Для контроля присутствия.',
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        CamAI предлагает 4 умные функции для каждой камеры. Включите нужные в настройках камеры.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', f.bg)}>
                <f.icon className={cn('h-5 w-5', f.color)} />
              </div>
              <h4 className="text-sm font-semibold">{f.title}</h4>
            </div>
            <p className="text-sm text-muted-foreground">{f.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
        <p className="text-sm font-medium mb-2">Как включить</p>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>1. Перейдите на страницу «Камеры»</p>
          <p>2. Нажмите на меню камеры → «Настройки»</p>
          <p>3. В разделе «Умные функции» включите нужные переключатели</p>
          <p>4. Настройте параметры (порог очереди, время и т.д.)</p>
          <p>5. Выберите интеграцию для отправки уведомлений</p>
        </div>
      </div>
    </div>
  );
}

function StepNotifications() {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Получайте мгновенные уведомления о событиях через удобный канал связи.
      </p>

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-blue-500" />
          Telegram (рекомендуется)
        </h3>
        <div className="rounded-lg border p-4 space-y-3 text-sm">
          <p><strong>Шаг 1:</strong> Создайте бота через <code className="bg-muted px-1 py-0.5 rounded">@BotFather</code> в Telegram</p>
          <p><strong>Шаг 2:</strong> Скопируйте Bot Token (формат: <code className="bg-muted px-1 py-0.5 rounded">123456:ABC-DEF...</code>)</p>
          <p><strong>Шаг 3:</strong> Создайте группу/канал и добавьте бота</p>
          <p><strong>Шаг 4:</strong> Получите Chat ID через <code className="bg-muted px-1 py-0.5 rounded">@userinfobot</code></p>
          <p><strong>Шаг 5:</strong> Введите Bot Token и Chat ID на странице «Интеграции»</p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Webhook className="h-5 w-5 text-orange-500" />
          Webhook
        </h3>
        <div className="rounded-lg border p-4 text-sm space-y-2">
          <p>Для интеграции с вашими системами используйте вебхуки. CamAI отправляет POST-запрос на указанный URL при каждом событии.</p>
          <p className="text-muted-foreground text-xs">Поддерживается JSON формат с типом события, камерой и сообщением.</p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Другие интеграции</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { label: 'Email (SMTP)', desc: 'Отправка на почту' },
            { label: 'SMS', desc: 'SMS-уведомления' },
            { label: 'Slack', desc: 'Уведомления в Slack' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border p-3 text-center">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
        <p className="text-sm text-muted-foreground">
          Все интеграции настраиваются на странице «Интеграции» в боковом меню.
          Каждую умную функцию можно привязать к своей интеграции.
        </p>
      </div>
    </div>
  );
}

function StepDone({ onNavigate }: { onNavigate: (path: string) => void }) {
  const links = [
    { href: '/cameras', icon: Camera, label: 'Добавить камеру', desc: 'Подключите первую камеру' },
    { href: '/integrations', icon: Bell, label: 'Настроить уведомления', desc: 'Подключите Telegram' },
    { href: '/dashboard', icon: LayoutDashboard, label: 'Перейти к дашборду', desc: 'Начать мониторинг' },
  ];

  return (
    <div className="text-center py-6">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600">
        <PartyPopper className="h-8 w-8 text-white" />
      </div>
      <h2 className="text-2xl font-bold mb-3">Всё готово!</h2>
      <p className="text-muted-foreground max-w-lg mx-auto mb-8">
        Вы изучили основы работы с CamAI. Теперь добавьте камеры,
        включите умные функции и настройте уведомления.
      </p>

      <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
        {links.map((link) => (
          <Card
            key={link.href}
            className="cursor-pointer hover:border-primary/50 transition-all"
            onClick={() => onNavigate(link.href)}
          >
            <CardContent className="p-4">
              <link.icon className="h-6 w-6 text-primary mb-2" />
              <p className="text-sm font-semibold">{link.label}</p>
              <p className="text-xs text-muted-foreground">{link.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const router = useRouter();
  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  function renderContent() {
    switch (currentStep) {
      case 0: return <StepWelcome />;
      case 1: return <StepRequirements />;
      case 2: return <StepInstallation />;
      case 3: return <StepCameras />;
      case 4: return <StepFeatures />;
      case 5: return <StepNotifications />;
      case 6: return <StepDone onNavigate={(path) => router.push(path)} />;
      default: return null;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Начало работы</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Шаг {currentStep + 1} из {steps.length} — {step.subtitle}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/dashboard')}
          className="text-muted-foreground"
        >
          <SkipForward className="h-4 w-4 mr-2" />
          Пропустить
        </Button>
      </div>

      {/* Progress */}
      <Progress value={progress} className="h-1.5" />

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto py-2">
        {steps.map((s, index) => (
          <div key={s.id} className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setCurrentStep(index)}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all',
                index < currentStep && 'bg-green-500 text-white',
                index === currentStep && 'bg-primary text-primary-foreground ring-2 ring-primary/30',
                index > currentStep && 'bg-muted text-muted-foreground'
              )}
            >
              {index < currentStep ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </button>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'h-0.5 w-4 sm:w-8 rounded-full hidden sm:block',
                  index < currentStep ? 'bg-green-500' : 'bg-muted'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          {/* Step title */}
          <div className="flex items-center gap-3 mb-6">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', step.iconBg)}>
              <step.icon className={cn('h-5 w-5', step.iconColor)} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{step.title}</h2>
              <p className="text-sm text-muted-foreground">{step.subtitle}</p>
            </div>
          </div>

          <Separator className="mb-6" />

          {renderContent()}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentStep((s) => s - 1)}
          disabled={currentStep === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Назад
        </Button>

        {currentStep < steps.length - 1 ? (
          <Button onClick={() => setCurrentStep((s) => s + 1)}>
            Далее
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={() => router.push('/dashboard')}>
            Перейти к дашборду
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
