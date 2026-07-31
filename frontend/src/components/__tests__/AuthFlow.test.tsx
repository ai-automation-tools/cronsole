import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the api module so the auth state machine can be driven deterministically.
// The token helpers are backed by a tiny in-memory value instead of localStorage.
const { apiMock, tokenState } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  tokenState: { value: null as string | null },
}));

vi.mock('../../api', () => ({
  api: apiMock,
  setAuthToken: (t: string) => { tokenState.value = t; },
  clearAuthToken: () => { tokenState.value = null; },
  hasLoginToken: () => tokenState.value !== null,
  getAuthToken: () => tokenState.value ?? undefined,
  subscribeAuthFailure: () => () => {},
}));

import { AuthProvider } from '../../hooks/AuthProvider';
import { AuthGate } from '../AuthGate';

function renderApp() {
  return render(
    <AuthProvider>
      <AuthGate>
        <div>DASHBOARD</div>
      </AuthGate>
    </AuthProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenState.value = null;
  window.localStorage.clear();
});

describe('auth flow', () => {
  it('shows the first-run setup screen when the backend reports needsSetup', async () => {
    apiMock.get.mockResolvedValue({ data: { needsSetup: true } });
    renderApp();

    expect(await screen.findByText('Create account')).toBeInTheDocument();
    expect(screen.getByText(/fresh Cronsole install/i)).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
  });

  it('shows the login screen when an account already exists', async () => {
    apiMock.get.mockResolvedValue({ data: { needsSetup: false } });
    renderApp();

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
  });

  it('logs in and reveals the app', async () => {
    apiMock.get.mockResolvedValue({ data: { needsSetup: false } });
    apiMock.post.mockResolvedValue({ data: { token: 'jwt-123', user: { id: 'u1', email: 'me@example.com' } } });
    renderApp();

    await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'a-good-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/auth/login', { email: 'me@example.com', password: 'a-good-password' });
  });

  it('surfaces the backend error on a bad login and stays on the login screen', async () => {
    apiMock.get.mockResolvedValue({ data: { needsSetup: false } });
    apiMock.post.mockRejectedValue({ response: { data: { error: 'Invalid email or password' } } });
    renderApp();

    await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
  });

  it('creates the account on first-run setup and reveals the app', async () => {
    apiMock.get.mockResolvedValue({ data: { needsSetup: true } });
    apiMock.post.mockResolvedValue({ data: { token: 'jwt-123', user: { id: 'u1', email: 'owner@example.com' } } });
    renderApp();

    await screen.findByText('Create account');
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'a-good-password' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), { target: { value: 'a-good-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/auth/setup', { email: 'owner@example.com', password: 'a-good-password' });
  });

  it('blocks setup with mismatched passwords before hitting the API', async () => {
    apiMock.get.mockResolvedValue({ data: { needsSetup: true } });
    renderApp();

    await screen.findByText('Create account');
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'a-good-password' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('trusts a stored login token and renders the app without a status probe', async () => {
    tokenState.value = 'existing-jwt';
    renderApp();

    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled(); // no /auth/status when already holding a token
  });
});
