import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

// Sidebar reads live connection health via useConnections (TanStack Query).
// Mock it so these unit tests don't need a QueryClientProvider or network.
vi.mock('../../hooks/useConnections', () => ({
  useConnections: () => ({
    data: [
      { platform: 'WINDOWS_TASK_SCHEDULER', state: 'HEALTHY' },
      { platform: 'CLAUDE_CODE', state: 'DEGRADED' },
    ],
    isLoading: false,
  }),
  healthMeta: (state: string) => ({ label: state, dot: '', text: '' }),
}));

// Sidebar reads the signed-in user + logout from useAuth; stub it so these unit
// tests don't need an AuthProvider or a backend.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'me@example.com' }, logout: vi.fn() }),
}));

import { Sidebar } from '../Sidebar';

describe('Sidebar Component', () => {
  it('renders branding and all navigation tabs', () => {
    const setActiveTab = vi.fn();
    render(<Sidebar activeTab="dashboard" setActiveTab={setActiveTab} />);

    expect(screen.getByText('TaskHub')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByText('Platforms')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('System Status')).toBeInTheDocument();
    // Live connection rows (labels from platformLabel).
    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('calls setActiveTab when a navigation button is clicked', () => {
    const setActiveTab = vi.fn();
    render(<Sidebar activeTab="dashboard" setActiveTab={setActiveTab} />);

    const templatesBtn = screen.getByText('Templates').closest('button');
    expect(templatesBtn).toBeInTheDocument();
    if (templatesBtn) {
      fireEvent.click(templatesBtn);
    }
    expect(setActiveTab).toHaveBeenCalledWith('templates');

    const settingsBtn = screen.getByText('Settings').closest('button');
    expect(settingsBtn).toBeInTheDocument();
    if (settingsBtn) {
      fireEvent.click(settingsBtn);
    }
    expect(setActiveTab).toHaveBeenCalledWith('settings');
  });

  it('closes the mobile drawer when a nav item is selected', () => {
    const onClose = vi.fn();
    render(
      <Sidebar activeTab="dashboard" setActiveTab={vi.fn()} open onClose={onClose} />
    );

    fireEvent.click(screen.getByText('Templates').closest('button')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes the mobile drawer on Escape when open', () => {
    const onClose = vi.fn();
    render(
      <Sidebar activeTab="dashboard" setActiveTab={vi.fn()} open onClose={onClose} />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not listen for Escape when the drawer is closed', () => {
    const onClose = vi.fn();
    render(
      <Sidebar activeTab="dashboard" setActiveTab={vi.fn()} open={false} onClose={onClose} />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('highlights the active tab', () => {
    const setActiveTab = vi.fn();
    const { rerender } = render(<Sidebar activeTab="dashboard" setActiveTab={setActiveTab} />);

    const dashboardBtn = screen.getByText('Dashboard').closest('button');
    expect(dashboardBtn).toHaveClass('bg-primary/10');

    rerender(<Sidebar activeTab="settings" setActiveTab={setActiveTab} />);
    const newDashboardBtn = screen.getByText('Dashboard').closest('button');
    const settingsBtn = screen.getByText('Settings').closest('button');
    expect(newDashboardBtn).not.toHaveClass('bg-primary/10');
    expect(settingsBtn).toHaveClass('bg-primary/10');
  });
});
