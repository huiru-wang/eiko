import { createContext, useContext, useRef, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from './api';
import { USER_ID } from './model';

export function readStorage(key: string): string { try { return localStorage.getItem(`${USER_ID}:${key}`) || ''; } catch { return ''; } }
export function writeStorage(key: string, value: string) { try { localStorage.setItem(`${USER_ID}:${key}`, value); return true; } catch { return false; } }
type State = { organizing: boolean; message: string; organize: () => Promise<void>; unread: (id: string, taskId: string) => boolean; markRead: (id: string, taskId: string) => void };
const Context = createContext<State>(null!);
export function WorkspaceProvider({ children }: PropsWithChildren) {
  const client = useQueryClient();
  const lock = useRef(false);
  const [organizing, setOrganizing] = useState(false);
  const [message, setMessage] = useState('');
  const [, changed] = useState(0);
  async function organize() {
    if (lock.current) return;
    lock.current = true; setOrganizing(true); setMessage('正在整理这批记录…');
    try {
      const result = await request<{ taskId: string | null; summary: string }>('/contemplate', 'POST', {});
      setMessage(result.taskId ? '本次整理已完成' : '暂无需要整理的记录');
    } catch (error) {
      setMessage(error instanceof ApiError && error.uncertain ? '结果待确认，请刷新回声与记录查看。不要立即重复整理。' : `整理未完成：${(error as Error).message}`);
    } finally {
      lock.current = false; setOrganizing(false);
      await client.invalidateQueries();
    }
  }
  return <Context.Provider value={{ organizing, message, organize,
    unread: (id, taskId) => readStorage(`read:${id}`) !== taskId,
    markRead: (id, taskId) => { writeStorage(`read:${id}`, taskId); changed(n => n + 1); },
  }}>{children}</Context.Provider>;
}
export const useWorkspace = () => useContext(Context);
