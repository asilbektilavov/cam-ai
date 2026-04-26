/**
 * Telegram bot — auto-discovers subscribers via getUpdates polling and
 * broadcasts attendance notifications (with photo) to all of them.
 *
 * To subscribe, a user/group sends any message to the bot (typically /start).
 * The bot then remembers their chat_id and includes them in future broadcasts.
 */
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import path from 'path';

const POLL_INTERVAL_MS = 5_000;
const POLL_KEY = '__telegramBotPolling';

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string; title?: string; first_name?: string; username?: string };
    text?: string;
  };
  channel_post?: {
    chat: { id: number; type: string; title?: string };
  };
}

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

async function fetchUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0&allowed_updates=["message","channel_post"]`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.ok ? (data.result as TelegramUpdate[]) : [];
  } catch {
    return [];
  }
}

async function registerChat(chat: NonNullable<TelegramUpdate['message']>['chat']): Promise<void> {
  // Single-org deployment: attach all subscribers to the first organization.
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return;
  const title = chat.title || chat.first_name || chat.username || `chat_${chat.id}`;
  await prisma.telegramSubscriber.upsert({
    where: { organizationId_chatId: { organizationId: org.id, chatId: String(chat.id) } },
    update: { isActive: true, chatType: chat.type, chatTitle: title },
    create: {
      organizationId: org.id,
      chatId: String(chat.id),
      chatType: chat.type,
      chatTitle: title,
      isActive: true,
    },
  });
  console.log(`[TelegramBot] Registered subscriber: ${title} (${chat.id}, ${chat.type})`);
}

async function pollOnce(state: { offset: number }): Promise<void> {
  const token = botToken();
  if (!token) return;
  const updates = await fetchUpdates(token, state.offset);
  for (const update of updates) {
    state.offset = update.update_id + 1;
    const chat = update.message?.chat || update.channel_post?.chat;
    if (chat) {
      await registerChat(chat).catch((e) =>
        console.error('[TelegramBot] Register error:', e instanceof Error ? e.message : e)
      );
    }
  }
}

export function startTelegramBotPolling(): void {
  type PollState = { offset: number; timer: ReturnType<typeof setInterval> | null };
  const proc = process as unknown as { [POLL_KEY]?: PollState };
  if (proc[POLL_KEY]?.timer) return;
  if (!botToken()) {
    console.log('[TelegramBot] TELEGRAM_BOT_TOKEN not set — polling disabled');
    return;
  }
  const state: PollState = { offset: 0, timer: null };
  state.timer = setInterval(() => {
    void pollOnce(state);
  }, POLL_INTERVAL_MS);
  proc[POLL_KEY] = state;
  console.log('[TelegramBot] Subscriber polling started');
  void pollOnce(state); // initial run
}

export interface AttendanceBroadcast {
  organizationId: string;
  employeeName: string;
  direction: 'check_in' | 'check_out';
  cameraName: string;
  cameraLocation?: string;
  confidence: number;
  snapshotPath?: string | null;
  employeePhotoPath?: string | null;
}

export async function broadcastAttendance(payload: AttendanceBroadcast): Promise<void> {
  const token = botToken();
  if (!token) return;

  const subs = await prisma.telegramSubscriber.findMany({
    where: { organizationId: payload.organizationId, isActive: true },
    select: { chatId: true },
  });
  if (subs.length === 0) return;

  const action = payload.direction === 'check_in' ? '🟢 Вход' : '🔴 Выход';
  const conf = Math.round(payload.confidence * 100);
  const time = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
  const caption =
    `${action}\n` +
    `👤 <b>${payload.employeeName}</b>\n` +
    `📷 ${payload.cameraName}${payload.cameraLocation ? ` (${payload.cameraLocation})` : ''}\n` +
    `🎯 Точность: ${conf}%\n` +
    `🕐 ${time}`;

  // Prefer the live attendance snapshot (just-captured frame), fall back to
  // the employee profile photo, then a text-only message.
  const photoFile = payload.snapshotPath || payload.employeePhotoPath;
  let photoBuffer: Buffer | null = null;
  if (photoFile) {
    try {
      photoBuffer = await readFile(path.join(process.cwd(), photoFile));
    } catch {
      photoBuffer = null;
    }
  }

  const sendOne = async (chatId: string): Promise<void> => {
    if (photoBuffer) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('photo', new Blob([new Uint8Array(photoBuffer)], { type: 'image/jpeg' }), 'snapshot.jpg');
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[TelegramBot] sendPhoto to ${chatId} failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } else {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[TelegramBot] sendMessage to ${chatId} failed: ${res.status} ${body.slice(0, 200)}`);
      }
    }
  };

  await Promise.allSettled(subs.map((s) => sendOne(s.chatId)));
}
