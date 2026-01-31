'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Timer,
  ShieldAlert,
  Monitor,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPut, apiDelete } from '@/lib/api-client';
import { IntegrationSelector } from './integration-selector';
import { QueueMonitorConfig } from './queue-monitor-config';
import { LoiteringConfig } from './loitering-config';
import { WorkstationConfig } from './workstation-config';

interface FeatureData {
  id?: string;
  featureType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  integrationId: string | null;
}

interface FeatureConfigPanelProps {
  cameraId: string;
}

const FEATURE_META = [
  {
    type: 'queue_monitor',
    label: 'Контроль очередей',
    description: 'Подсчёт людей в очереди и уведомление при превышении порога',
    icon: Users,
    defaultConfig: { maxQueueLength: 5 },
  },
  {
    type: 'workstation_monitor',
    label: 'Контроль рабочей зоны',
    description: 'Уведомление если рабочее место пустует слишком долго',
    icon: Monitor,
    defaultConfig: { minPeople: 1, maxAbsenceSeconds: 120 },
  },
  {
    type: 'loitering_detection',
    label: 'Детекция праздношатания',
    description: 'Обнаружение людей, которые находятся на одном месте слишком долго',
    icon: Timer,
    defaultConfig: { maxLoiterSeconds: 300 },
  },
  {
    type: 'person_search',
    label: 'Поиск человека',
    description: 'Поиск конкретного человека по фотографии на данной камере',
    icon: ShieldAlert,
    defaultConfig: {},
  },
];

export function FeatureConfigPanel({ cameraId }: FeatureConfigPanelProps) {
  const [features, setFeatures] = useState<Map<string, FeatureData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [savingFeature, setSavingFeature] = useState<string | null>(null);

  const fetchFeatures = useCallback(async () => {
    try {
      const data = await apiGet<FeatureData[]>(`/api/cameras/${cameraId}/smart-features`);
      const map = new Map<string, FeatureData>();
      for (const f of data) {
        map.set(f.featureType, f);
      }
      setFeatures(map);
    } catch {
      // Features may not exist yet — that's ok
    } finally {
      setLoading(false);
    }
  }, [cameraId]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const handleToggle = async (featureType: string, meta: typeof FEATURE_META[number]) => {
    const existing = features.get(featureType);
    const newEnabled = !(existing?.enabled ?? false);

    setSavingFeature(featureType);
    try {
      if (!newEnabled && existing) {
        // Disable — delete the feature
        await apiDelete(`/api/cameras/${cameraId}/smart-features/${featureType}`);
        setFeatures((prev) => {
          const next = new Map(prev);
          next.delete(featureType);
          return next;
        });
        toast.success(`${meta.label} отключён`);
      } else {
        // Enable — upsert
        const result = await apiPut<FeatureData>(
          `/api/cameras/${cameraId}/smart-features/${featureType}`,
          {
            enabled: true,
            config: existing?.config || meta.defaultConfig,
            integrationId: existing?.integrationId || null,
          }
        );
        setFeatures((prev) => {
          const next = new Map(prev);
          next.set(featureType, result);
          return next;
        });
        setExpandedFeature(featureType);
        toast.success(`${meta.label} включён`);
      }
    } catch {
      toast.error('Ошибка при переключении функции');
    } finally {
      setSavingFeature(null);
    }
  };

  const handleSaveConfig = async (featureType: string, config: Record<string, unknown>, integrationId: string | null) => {
    setSavingFeature(featureType);
    try {
      const result = await apiPut<FeatureData>(
        `/api/cameras/${cameraId}/smart-features/${featureType}`,
        { enabled: true, config, integrationId }
      );
      setFeatures((prev) => {
        const next = new Map(prev);
        next.set(featureType, result);
        return next;
      });
      toast.success('Настройки сохранены');
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSavingFeature(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Умные функции</p>
      {FEATURE_META.map((meta) => {
        const feature = features.get(meta.type);
        const isEnabled = feature?.enabled ?? false;
        const isExpanded = expandedFeature === meta.type;
        const isSaving = savingFeature === meta.type;
        const Icon = meta.icon;

        return (
          <div
            key={meta.type}
            className={cn(
              'rounded-lg border p-3 transition-all',
              isEnabled && 'border-green-500/30 bg-green-500/5'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                    isEnabled ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{meta.label}</p>
                    {isEnabled && <Badge variant="secondary" className="text-[10px]">Вкл</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{meta.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isEnabled && meta.type !== 'person_search' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setExpandedFeature(isExpanded ? null : meta.type)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={() => handleToggle(meta.type, meta)}
                  />
                )}
              </div>
            </div>

            {/* Expanded config */}
            {isEnabled && isExpanded && meta.type !== 'person_search' && (
              <FeatureSettings
                featureType={meta.type}
                config={(feature?.config || meta.defaultConfig) as Record<string, unknown>}
                integrationId={feature?.integrationId || null}
                saving={isSaving}
                onSave={(config, integrationId) => handleSaveConfig(meta.type, config, integrationId)}
              />
            )}

            {isEnabled && meta.type === 'person_search' && (
              <p className="text-xs text-muted-foreground mt-2 pl-11">
                Управление поиском — на странице «Поиск людей»
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FeatureSettings({
  featureType,
  config,
  integrationId,
  saving,
  onSave,
}: {
  featureType: string;
  config: Record<string, unknown>;
  integrationId: string | null;
  saving: boolean;
  onSave: (config: Record<string, unknown>, integrationId: string | null) => void;
}) {
  const [localConfig, setLocalConfig] = useState(config);
  const [localIntegration, setLocalIntegration] = useState(integrationId);

  return (
    <div className="mt-3 pl-11 space-y-3 border-t pt-3">
      {featureType === 'queue_monitor' && (
        <QueueMonitorConfig
          config={localConfig as { maxQueueLength?: number }}
          onChange={(c) => setLocalConfig(c)}
        />
      )}
      {featureType === 'loitering_detection' && (
        <LoiteringConfig
          config={localConfig as { maxLoiterSeconds?: number }}
          onChange={(c) => setLocalConfig(c)}
        />
      )}
      {featureType === 'workstation_monitor' && (
        <WorkstationConfig
          config={localConfig as { minPeople?: number; maxAbsenceSeconds?: number }}
          onChange={(c) => setLocalConfig(c)}
        />
      )}
      <IntegrationSelector value={localIntegration} onChange={setLocalIntegration} />
      <Button
        size="sm"
        onClick={() => onSave(localConfig, localIntegration)}
        disabled={saving}
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
        Сохранить
      </Button>
    </div>
  );
}
