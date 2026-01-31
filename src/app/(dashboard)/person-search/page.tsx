'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ScanFace,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { FaceExtractor } from '@/components/person-search/face-extractor';
import { SightingTimeline } from '@/components/person-search/sighting-timeline';
import { IntegrationSelector } from '@/components/smart-features/integration-selector';

interface SearchPerson {
  id: string;
  name: string;
  photoPath: string;
  isActive: boolean;
  integrationId: string | null;
  createdAt: string;
  integration: { id: string; type: string; name: string } | null;
  _count: { sightings: number };
}

interface PersonDetail extends SearchPerson {
  sightings: Array<{
    id: string;
    timestamp: string;
    confidence: number;
    description: string | null;
    camera: { id: string; name: string; location: string };
  }>;
}

export default function PersonSearchPage() {
  const [persons, setPersons] = useState<SearchPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [detailPerson, setDetailPerson] = useState<PersonDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newIntegrationId, setNewIntegrationId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<{
    photoBase64: string;
    descriptor: number[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchPersons = useCallback(async () => {
    try {
      const data = await apiGet<SearchPerson[]>('/api/person-search');
      setPersons(data);
    } catch {
      toast.error('Не удалось загрузить список');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPersons();
  }, [fetchPersons]);

  const handleAdd = async () => {
    if (!newName.trim()) {
      toast.error('Введите имя');
      return;
    }
    if (!extractedData) {
      toast.error('Загрузите фото и дождитесь извлечения лица');
      return;
    }

    setSaving(true);
    try {
      await apiPost('/api/person-search', {
        name: newName.trim(),
        photoBase64: extractedData.photoBase64,
        faceDescriptor: extractedData.descriptor,
        integrationId: newIntegrationId,
      });
      toast.success(`Поиск "${newName}" создан`);
      setAddDialogOpen(false);
      setNewName('');
      setNewIntegrationId(null);
      setExtractedData(null);
      fetchPersons();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (person: SearchPerson) => {
    try {
      await apiPatch(`/api/person-search/${person.id}`, {
        isActive: !person.isActive,
      });
      setPersons((prev) =>
        prev.map((p) => (p.id === person.id ? { ...p, isActive: !p.isActive } : p))
      );
      toast.success(person.isActive ? 'Поиск приостановлен' : 'Поиск возобновлён');
    } catch {
      toast.error('Ошибка');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/person-search/${id}`);
      setPersons((prev) => prev.filter((p) => p.id !== id));
      toast.success('Удалено');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const loadDetail = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    try {
      const data = await apiGet<PersonDetail>(`/api/person-search/${id}`);
      setDetailPerson(data);
    } catch {
      toast.error('Не удалось загрузить детали');
    } finally {
      setDetailLoading(false);
    }
  };

  const activeCount = persons.filter((p) => p.isActive).length;
  const totalSightings = persons.reduce((acc, p) => acc + p._count.sightings, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Поиск людей</h1>
          <p className="text-muted-foreground">
            Загрузите фото человека — камеры будут его искать
          </p>
        </div>
        <Button className="gap-2" onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Добавить
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <ScanFace className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{persons.length}</p>
              <p className="text-sm text-muted-foreground">Всего поисков</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Eye className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeCount}</p>
              <p className="text-sm text-muted-foreground">Активные</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <Clock className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalSightings}</p>
              <p className="text-sm text-muted-foreground">Обнаружений</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Persons List */}
      {persons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ScanFace className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Список пуст</h3>
            <p className="text-muted-foreground mb-4">
              Добавьте фото человека, чтобы камеры начали его искать
            </p>
            <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {persons.map((person) => (
            <Card
              key={person.id}
              className={cn(
                'transition-all',
                person.isActive && 'border-green-500/30 bg-green-500/5'
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Photo thumbnail */}
                  <div className="h-14 w-14 rounded-lg bg-muted overflow-hidden shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/person-search/${person.id}/photo`}
                      alt={person.name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{person.name}</h3>
                      <Badge variant={person.isActive ? 'default' : 'secondary'} className="text-[10px]">
                        {person.isActive ? 'Активен' : 'Приостановлен'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span>Обнаружений: {person._count.sightings}</span>
                      {person.integration && (
                        <span>Уведомления: {person.integration.name}</span>
                      )}
                      <span>
                        {new Date(person.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => loadDetail(person.id)}
                    >
                      {expandedId === person.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleToggleActive(person)}
                    >
                      {person.isActive ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(person.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Expanded detail */}
                {expandedId === person.id && (
                  <div className="mt-4 pt-4 border-t">
                    {detailLoading ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : detailPerson ? (
                      <SightingTimeline sightings={detailPerson.sightings} />
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Person Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить человека для поиска</DialogTitle>
            <DialogDescription>
              Загрузите чёткое фото с лицом человека
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Имя</Label>
              <Input
                placeholder="Иванов Иван"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Фото</Label>
              <FaceExtractor onExtracted={setExtractedData} />
            </div>

            <IntegrationSelector
              value={newIntegrationId}
              onChange={setNewIntegrationId}
            />

            <Button
              className="w-full"
              onClick={handleAdd}
              disabled={saving || !extractedData || !newName.trim()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Начать поиск
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
