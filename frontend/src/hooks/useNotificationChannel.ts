import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export type WebhookType = 'generic' | 'discord' | 'ntfy' | 'resend';

/**
 * A user's own opt-in run-outcome webhook — GET/PUT `/api/notifications/webhook`.
 * Off by default (`NotificationChannel`, schema.prisma). Headers are
 * write-only: the server never echoes a saved value back, only
 * `hasHeaders` — the same shape a saved Gemini MCP preset reports. `to` and
 * `from` (resend only) are not credentials — the API key lives in a header —
 * so they round-trip like `url` does.
 */
export interface NotificationChannel {
  enabled: boolean;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  url: string | null;
  type: WebhookType | null;
  hasHeaders: boolean;
  to: string | null;
  from: string | null;
  updatedAt: string | null;
}

export interface SaveNotificationChannelInput {
  enabled: boolean;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  url?: string;
  type?: WebhookType;
  headers?: Record<string, string>;
  to?: string;
  from?: string;
}

export function useNotificationChannel() {
  const queryClient = useQueryClient();

  const query = useQuery<NotificationChannel>({
    queryKey: ['notificationChannel'],
    queryFn: async () => {
      const res = await api.get('/notifications/webhook');
      return res.data;
    }
  });

  const save = useMutation({
    mutationFn: async (input: SaveNotificationChannelInput) => {
      const res = await api.put('/notifications/webhook', input);
      return res.data as NotificationChannel;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['notificationChannel'], data);
    }
  });

  return { ...query, save };
}
