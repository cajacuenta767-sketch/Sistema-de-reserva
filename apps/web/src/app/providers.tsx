import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/design-system';
import { AuthProvider } from '@/store/auth';
import { ThemeProvider } from '@/store/theme';
import { ToastProvider } from '@/store/toast';
import { ApiError } from '@/lib/api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Reintentar un 403 o un 404 no los va a arreglar y multiplica el ruido
        // en los logs del servidor.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export { queryClient };
