import { useEffect, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { WorkspaceProvider } from './lib/state';
import './app.scss';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15000, retry: false, refetchOnWindowFocus: 'always' }, mutations: { retry: false } } });
export default function App({ children }: PropsWithChildren) {
  useEffect(() => focusManager.setEventListener(handle => {
    const listener = () => handle(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }), []);
  return <QueryClientProvider client={client}><WorkspaceProvider>{children}</WorkspaceProvider></QueryClientProvider>;
}
