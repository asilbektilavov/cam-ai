'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Camera,
  MapPin,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

interface Branch {
  id: string;
  name: string;
  address: string | null;
  createdAt: string;
  _count: { cameras: number };
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', address: '' });
  const [editId, setEditId] = useState<string | null>(null);

  const fetchBranches = useCallback(async () => {
    try {
      const data = await apiGet<{ branches: Branch[] }>('/api/branches');
      setBranches(data.branches);
    } catch (err) {
      console.error('Failed to fetch branches:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const handleAdd = async () => {
    if (!form.name.trim()) {
      toast.error('Введите название филиала');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/branches', {
        name: form.name.trim(),
        address: form.address.trim() || undefined,
      });
      toast.success(`Филиал "${form.name}" создан`);
      setForm({ name: '', address: '' });
      setAddOpen(false);
      fetchBranches();
    } catch {
      toast.error('Не удалось создать филиал');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (branch: Branch) => {
    setEditId(branch.id);
    setForm({ name: branch.name, address: branch.address || '' });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editId || !form.name.trim()) return;
    setSaving(true);
    try {
      await apiPatch(`/api/branches/${editId}`, {
        name: form.name.trim(),
        address: form.address.trim() || null,
      });
      toast.success('Филиал обновлён');
      setEditOpen(false);
      setForm({ name: '', address: '' });
      setEditId(null);
      fetchBranches();
    } catch {
      toast.error('Не удалось обновить филиал');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiDelete(`/api/branches/${deleteId}`);
      toast.success('Филиал удалён');
      setDeleteId(null);
      fetchBranches();
    } catch {
      toast.error('Не удалось удалить филиал. Нельзя удалить последний филиал.');
    }
  };

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
          <h1 className="text-2xl font-bold">Филиалы</h1>
          <p className="text-muted-foreground">
            Управление филиалами вашей организации
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить филиал
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Новый филиал</DialogTitle>
              <DialogDescription>
                Создайте филиал для группировки камер по местоположению
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input
                  placeholder="Например: Офис на Тверской"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Адрес (необязательно)</Label>
                <Input
                  placeholder="г. Москва, ул. Тверская, д. 1"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <Button onClick={handleAdd} className="w-full" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Создать
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Branch Cards */}
      {branches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Нет филиалов</h3>
            <p className="text-muted-foreground mb-4">
              Создайте первый филиал для организации камер
            </p>
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить филиал
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map((branch) => (
            <Card key={branch.id} className="group relative">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{branch.name}</h3>
                      {branch.address && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                          <p className="text-sm text-muted-foreground truncate">
                            {branch.address}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(branch)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(branch.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                  <Camera className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {branch._count.cameras}{' '}
                    {branch._count.cameras === 1
                      ? 'камера'
                      : branch._count.cameras >= 2 && branch._count.cameras <= 4
                        ? 'камеры'
                        : 'камер'}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Редактировать филиал</DialogTitle>
            <DialogDescription>Измените данные филиала</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Адрес</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleEdit} className="flex-1" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Сохранить
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить филиал?</AlertDialogTitle>
            <AlertDialogDescription>
              Все камеры и события этого филиала будут удалены. Это действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
