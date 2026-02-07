'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Shield, Eye, Wrench, Loader2, Trash2, MoreHorizontal, Mail, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  admin: 'Администратор',
  operator: 'Оператор',
  viewer: 'Наблюдатель',
};

const roleIcons: Record<string, React.ElementType> = {
  admin: Shield,
  operator: Wrench,
  viewer: Eye,
};

const roleColors: Record<string, string> = {
  superadmin: 'bg-purple-500/10 text-purple-500',
  admin: 'bg-blue-500/10 text-blue-500',
  operator: 'bg-orange-500/10 text-orange-500',
  viewer: 'bg-gray-500/10 text-gray-500',
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviting, setInviting] = useState(false);

  const loadTeam = useCallback(async () => {
    try {
      const data = await apiGet<{ members: Member[]; invites: Invite[] }>('/api/team');
      setMembers(data.members);
      setInvites(data.invites);
    } catch {
      toast.error('Не удалось загрузить команду');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.error('Введите email');
      return;
    }
    setInviting(true);
    try {
      await apiPost('/api/team', { email: inviteEmail, role: inviteRole });
      toast.success('Приглашение отправлено');
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('viewer');
      await loadTeam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      await apiPatch(`/api/team/${userId}`, { role: newRole });
      toast.success('Роль обновлена');
      await loadTeam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  const handleRemove = async (userId: string, userName: string) => {
    if (!confirm(`Удалить ${userName} из команды?`)) return;
    try {
      await apiDelete(`/api/team/${userId}`);
      toast.success('Пользователь удалён');
      await loadTeam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Команда</h1>
          <p className="text-muted-foreground">{members.length} участников</p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Пригласить
        </Button>
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Участники</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((member) => {
            const RoleIcon = roleIcons[member.role] || Shield;
            return (
              <div key={member.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-bold">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={roleColors[member.role] || roleColors.viewer} variant="secondary">
                    <RoleIcon className="h-3 w-3 mr-1" />
                    {roleLabels[member.role] || member.role}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleChangeRole(member.id, 'admin')}>
                        <Shield className="h-3.5 w-3.5 mr-2" /> Администратор
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleChangeRole(member.id, 'operator')}>
                        <Wrench className="h-3.5 w-3.5 mr-2" /> Оператор
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleChangeRole(member.id, 'viewer')}>
                        <Eye className="h-3.5 w-3.5 mr-2" /> Наблюдатель
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleRemove(member.id, member.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Удалить
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Ожидающие приглашения
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {invites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{invite.email}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Истекает {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                </div>
                <Badge variant="outline">{roleLabels[invite.role] || invite.role}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Пригласить в команду</DialogTitle>
            <DialogDescription>Отправьте приглашение по email</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Роль</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Администратор — полный доступ</SelectItem>
                  <SelectItem value="operator">Оператор — камеры и аналитика</SelectItem>
                  <SelectItem value="viewer">Наблюдатель — только просмотр</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleInvite} disabled={inviting}>
              {inviting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Отправить приглашение
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
