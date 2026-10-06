/** The lifetimes `POST /api/auth/tokens` accepts — shared by Settings and the phone-shortcut modal. */
export type ApiTokenLifetime = '30d' | '60d' | '90d' | 'never';

export const LIFETIMES: { value: ApiTokenLifetime; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '60d', label: '60 days' },
  { value: '90d', label: '90 days' },
  { value: 'never', label: 'Never expires' }
];
