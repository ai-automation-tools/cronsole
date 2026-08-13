import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { HelpModal } from '../HelpModal';
import { GETTING_STARTED_STEPS, HELP_GUIDES } from '../../data/onboarding';
import { helpTopics } from '../../data/help';

describe('HelpModal', () => {
  it('renders the getting-started walkthrough steps', () => {
    render(<HelpModal onClose={() => {}} />);
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
    for (const step of GETTING_STARTED_STEPS) {
      expect(screen.getByText(new RegExp(step.title))).toBeInTheDocument();
    }
  });

  it('links every guide doc (new-tab, correct href)', () => {
    render(<HelpModal onClose={() => {}} />);
    for (const guide of HELP_GUIDES) {
      // Some labels also appear as a walkthrough step link, so match any anchor
      // in the doc that carries this guide's exact href.
      const anchors = screen.getAllByText(guide.label)
        .map(el => el.closest('a'))
        .filter((a): a is HTMLAnchorElement => a?.getAttribute('href') === guide.url);
      expect(anchors.length).toBeGreaterThan(0);
      expect(anchors[0]).toHaveAttribute('target', '_blank');
      expect(anchors[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('calls onClose from the footer button', () => {
    const onClose = vi.fn();
    render(<HelpModal onClose={onClose} />);
    fireEvent.click(screen.getByText('Close Help Center'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('indexes every topic the ? buttons use', () => {
    // The two entry points fail in opposite directions: a `?` is only findable
    // once you are already looking at the control it explains, and the hub is
    // only useful if it can reach what those buttons say. So the hub lists them
    // all, and a topic added without appearing here would be reachable only by
    // accident.
    render(<HelpModal onClose={() => {}} />);
    for (const topic of helpTopics()) {
      expect(screen.getByRole('button', { name: topic.title })).toBeInTheDocument();
    }
  });

  it('opens straight onto a topic when given one', () => {
    render(<HelpModal topic="mass-actions" onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Mass actions' })).toBeInTheDocument();
    // …and the hub is not also rendered underneath it.
    expect(screen.queryByText('Cronsole Help Center')).not.toBeInTheDocument();
  });

  it('navigates from the hub into a topic and back', () => {
    render(<HelpModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Task health' }));
    expect(screen.getByRole('heading', { name: 'Task health' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Browse all help/i }));
    expect(screen.getByText('Cronsole Help Center')).toBeInTheDocument();
  });
});
