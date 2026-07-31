import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';

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

    expect(screen.getByText('Cronsole')).toBeInTheDocument();
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

describe('Sidebar accessibility of the mobile drawer', () => {
  const originalMatchMedia = window.matchMedia;

  /** Answer `(min-width: 768px)` — i.e. put the test on desktop or on mobile. */
  function setViewport(desktop: boolean) {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('min-width: 768px') ? desktop : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('takes the closed drawer out of the tab order and the a11y tree on mobile', () => {
    // The drawer is hidden with a transform, which is purely visual — without
    // `inert` its buttons stay focusable and a keyboard user tabs through an
    // invisible menu before reaching the page. `byRole` only sees accessible
    // elements, so this asserts the behavior, not just the attribute.
    setViewport(false);
    const { container } = render(
      <Sidebar activeTab="dashboard" setActiveTab={vi.fn()} open={false} onClose={vi.fn()} />
    );

    expect(screen.queryByRole('button', { name: 'Templates' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    const aside = container.querySelector('aside')!;
    expect(aside).toHaveAttribute('aria-hidden', 'true');
    expect(aside).toHaveAttribute('inert');
  });

  it('makes the drawer reachable again once it is open', () => {
    setViewport(false);
    const { container } = render(
      <Sidebar activeTab="dashboard" setActiveTab={vi.fn()} open onClose={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Templates' })).toBeInTheDocument();
    const aside = container.querySelector('aside')!;
    expect(aside).not.toHaveAttribute('aria-hidden');
    expect(aside).not.toHaveAttribute('inert');
  });

  it('never hides the desktop sidebar, where `open` is meaningless', () => {
    // At `md` and up the same element is the real, always-visible navigation and
    // `open` stays false — inerting on that signal alone would hide the whole nav.
    setViewport(true);
    const { container } = render(
      <Sidebar activeTab="dashboard" setActiveTab={vi.fn()} open={false} onClose={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Templates' })).toBeInTheDocument();
    const aside = container.querySelector('aside')!;
    expect(aside).not.toHaveAttribute('aria-hidden');
    expect(aside).not.toHaveAttribute('inert');
  });
});
