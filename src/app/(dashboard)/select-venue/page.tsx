'use client';

import { useRouter } from 'next/navigation';
import {
  ShoppingBag,
  UtensilsCrossed,
  Warehouse,
  Building2,
  Landmark,
  Car,
  Video,
  ArrowRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { VenueType } from '@/lib/types';

const venueOptions: {
  type: VenueType;
  label: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
  features: string[];
}[] = [
  {
    type: 'retail',
    label: 'Розничный магазин',
    description: 'Супермаркеты, ТЦ, бутики',
    icon: ShoppingBag,
    gradient: 'from-blue-500 to-blue-600',
    features: ['Подсчёт посетителей', 'Тепловые карты', 'Детекция краж'],
  },
  {
    type: 'restaurant',
    label: 'Ресторан / Кафе',
    description: 'Рестораны, кафе, бары, столовые',
    icon: UtensilsCrossed,
    gradient: 'from-orange-500 to-orange-600',
    features: ['Заполненность столов', 'Время ожидания', 'Контроль гигиены'],
  },
  {
    type: 'warehouse',
    label: 'Склад / Производство',
    description: 'Склады, цеха, производственные линии',
    icon: Warehouse,
    gradient: 'from-green-500 to-green-600',
    features: ['Охрана труда', 'Инвентаризация', 'Контроль доступа'],
  },
  {
    type: 'office',
    label: 'Офис',
    description: 'Бизнес-центры, коворкинги, офисы',
    icon: Building2,
    gradient: 'from-purple-500 to-purple-600',
    features: ['Учёт посещаемости', 'Загрузка комнат', 'Безопасность'],
  },
  {
    type: 'bank',
    label: 'Банк / Финансы',
    description: 'Отделения банков, обменные пункты',
    icon: Landmark,
    gradient: 'from-yellow-500 to-yellow-600',
    features: ['Подозрительное поведение', 'Мониторинг ATM', 'Распознавание лиц'],
  },
  {
    type: 'parking',
    label: 'Парковка',
    description: 'Паркинги, гаражи, автостоянки',
    icon: Car,
    gradient: 'from-cyan-500 to-cyan-600',
    features: ['Распознавание номеров', 'Заполненность', 'Нарушения'],
  },
];

export default function SelectVenuePage() {
  const router = useRouter();
  const { setSelectedVenue } = useAppStore();

  const handleSelect = (type: VenueType) => {
    setSelectedVenue(type);
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-500/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-purple-500/5 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600">
              <Video className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-3">Выберите тип заведения</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Мы настроим ИИ-аналитику под специфику вашего бизнеса
          </p>
        </div>

        {/* Venue Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {venueOptions.map((venue) => (
            <Card
              key={venue.type}
              className="group cursor-pointer border-border transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:scale-[1.02] p-0"
              onClick={() => handleSelect(venue.type)}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={cn(
                      'flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white',
                      venue.gradient
                    )}
                  >
                    <venue.icon className="h-6 w-6" />
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-1" />
                </div>
                <h3 className="text-lg font-semibold mb-1">{venue.label}</h3>
                <p className="text-sm text-muted-foreground mb-4">{venue.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {venue.features.map((feature) => (
                    <span
                      key={feature}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
