import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { vi, describe, it, expect } from 'vitest';

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
    expect(screen.getByText('Windows Agent')).toBeInTheDocument();
    expect(screen.getByText('Claude API')).toBeInTheDocument();
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
