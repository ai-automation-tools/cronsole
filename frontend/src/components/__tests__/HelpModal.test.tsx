import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { HelpModal } from '../HelpModal';
import { GETTING_STARTED_STEPS, HELP_GUIDES } from '../../data/onboarding';

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
});
