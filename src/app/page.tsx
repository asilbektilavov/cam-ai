'use client';

import Link from 'next/link';
import { Video, Shield, BarChart3, Zap, Camera, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  {
    icon: Camera,
    title: 'Умные камеры',
    description: 'Подключайте любые IP-камеры и получайте ИИ-аналитику в реальном времени',
  },
  {
    icon: Shield,
    title: 'Безопасность',
    description: 'Детекция подозрительного поведения, краж и нарушений безопасности',
  },
  {
    icon: BarChart3,
    title: 'Глубокая аналитика',
    description: 'Подсчёт посетителей, тепловые карты, анализ очередей и поведения',
  },
  {
    icon: Zap,
    title: 'Мгновенные оповещения',
    description: 'Telegram, Email, SMS — получайте уведомления о важных событиях',
  },
];

const stats = [
  { value: '50+', label: 'ИИ-функций анализа' },
  { value: '99.9%', label: 'Точность детекции' },
  { value: '24/7', label: 'Мониторинг' },
  { value: '<1с', label: 'Время реакции' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Video className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold">CamAI</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost">Войти</Button>
            </Link>
            <Link href="/register">
              <Button>Начать бесплатно</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground mb-8">
            <Zap className="h-4 w-4 text-yellow-500" />
            Новое поколение видеоаналитики
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6">
            Видеонаблюдение{' '}
            <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
              с интеллектом
            </span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            CamAI превращает обычные камеры наблюдения в мощный инструмент анализа.
            Детекция угроз, подсчёт посетителей, тепловые карты — всё в одной платформе.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="gap-2 text-base px-8">
                Попробовать бесплатно
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="text-base px-8">
                Демо-доступ
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y border-border bg-muted/30">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 px-6">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Всё для вашей безопасности</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Полный набор инструментов ИИ-аналитики для любого типа бизнеса
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/10 to-purple-600/10 mb-4">
                  <feature.icon className="h-6 w-6 text-blue-500" />
                </div>
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Venue Types */}
      <section className="py-20 px-6 bg-muted/30">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Для любого типа заведения</h2>
          <p className="text-muted-foreground mb-12">
            Специализированные ИИ-модели для каждого типа бизнеса
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Розничные магазины', items: ['Подсчёт посетителей', 'Тепловые карты', 'Детекция краж'] },
              { label: 'Рестораны и кафе', items: ['Заполненность столов', 'Время ожидания', 'Контроль гигиены'] },
              { label: 'Склады', items: ['Охрана труда', 'Отслеживание грузов', 'Контроль зон'] },
              { label: 'Офисы', items: ['Учёт посещаемости', 'Загрузка помещений', 'Безопасность'] },
              { label: 'Банки', items: ['Подозрительное поведение', 'Распознавание лиц', 'Анализ очередей'] },
              { label: 'Парковки', items: ['Распознавание номеров', 'Заполненность', 'Транспортный поток'] },
            ].map((venue) => (
              <div key={venue.label} className="rounded-xl border border-border bg-card p-5 text-left">
                <h3 className="font-semibold mb-3">{venue.label}</h3>
                <ul className="space-y-1.5">
                  {venue.items.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Готовы начать?</h2>
          <p className="text-muted-foreground mb-8">
            Подключите камеры и начните получать ИИ-аналитику уже сегодня
          </p>
          <Link href="/register">
            <Button size="lg" className="gap-2 text-base px-8">
              Создать аккаунт
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-blue-500" />
            <span className="font-semibold">CamAI</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} CamAI. Все права защищены.
          </p>
        </div>
      </footer>
    </div>
  );
}
