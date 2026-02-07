'use client';

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { MessageCircle, Send, X, Bot, User, Sparkles } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const STORAGE_KEY = 'camai-chat-messages';

const QUICK_ACTIONS = [
  'Что случилось за последний час?',
  'Сводка за сегодня',
  'Критические события',
];

function loadMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((m: { role: string; content: string; timestamp: string }) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // sessionStorage full or unavailable
  }
}

export function AiChat({ className }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load messages from sessionStorage on mount
  useEffect(() => {
    setMessages(loadMessages());
  }, []);

  // Persist messages
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-slot="scroll-area-viewport"]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMessage: ChatMessage = {
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInput('');
      setIsLoading(true);

      // Abort any previous request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  accumulated += `\n[Ошибка: ${parsed.error}]`;
                } else if (parsed.text) {
                  accumulated += parsed.text;
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          }

          // Update the assistant message with accumulated text
          const currentText = accumulated;
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: currentText };
            }
            return updated;
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const errorText = 'Не удалось получить ответ. Попробуйте позже.';
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = { ...updated[lastIdx], content: errorText };
          }
          return updated;
        });
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <div className={cn('fixed bottom-6 right-6 z-50', className)}>
      {/* Chat Panel */}
      <div
        className={cn(
          'absolute bottom-16 right-0 w-[400px] h-[500px] transition-all duration-300 origin-bottom-right',
          isOpen
            ? 'scale-100 opacity-100 translate-y-0 pointer-events-auto'
            : 'scale-95 opacity-0 translate-y-2 pointer-events-none'
        )}
      >
        <div className="flex flex-col h-full rounded-xl border bg-card text-card-foreground shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
                <Sparkles className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">CamAI Ассистент</h3>
                <p className="text-xs text-white/70">ИИ-помощник</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-white hover:bg-white/20 hover:text-white"
              onClick={handleToggle}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea ref={scrollRef} className="flex-1 px-4 py-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-blue-500/10 to-purple-600/10 mb-3">
                  <Bot className="size-6 text-blue-500" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  Привет! Я ваш ИИ-ассистент.
                </p>
                <p className="text-xs text-muted-foreground">
                  Задайте вопрос о событиях, камерах или аналитике.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'flex gap-2 max-w-[85%]',
                    msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center size-6 rounded-full shrink-0 mt-0.5',
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gradient-to-r from-blue-500/10 to-purple-600/10'
                    )}
                  >
                    {msg.role === 'user' ? (
                      <User className="size-3.5" />
                    ) : (
                      <Bot className="size-3.5 text-blue-500" />
                    )}
                  </div>
                  <div
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {msg.content || (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <span className="animate-pulse">Думаю</span>
                        <span className="animate-bounce [animation-delay:0ms]">.</span>
                        <span className="animate-bounce [animation-delay:150ms]">.</span>
                        <span className="animate-bounce [animation-delay:300ms]">.</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Quick Actions */}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  onClick={() => sendMessage(action)}
                  disabled={isLoading}
                  className="text-xs px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                >
                  {action}
                </button>
              ))}
            </div>
          )}

          {/* Input Area */}
          <div className="border-t px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Введите вопрос..."
                rows={1}
                disabled={isLoading}
                className={cn(
                  'flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'max-h-[80px] min-h-[36px] dark:bg-input/30'
                )}
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 80) + 'px';
                }}
              />
              <Button
                size="icon"
                disabled={!input.trim() || isLoading}
                onClick={() => sendMessage(input)}
                className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shrink-0"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Button */}
      <Button
        onClick={handleToggle}
        size="icon-lg"
        className={cn(
          'rounded-full shadow-lg transition-all duration-300 size-14',
          isOpen
            ? 'bg-muted text-muted-foreground hover:bg-muted/80'
            : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white'
        )}
      >
        {isOpen ? (
          <X className="size-5" />
        ) : (
          <MessageCircle className="size-5" />
        )}
      </Button>
    </div>
  );
}
