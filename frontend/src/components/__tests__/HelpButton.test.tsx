import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HelpButton } from '../HelpButton';
import { helpTopic, sourceTopicId } from '../../data/help';

/**
 * The `?` beside a control.
 *
 * What is pinned here is the behaviour that makes eight of these on one screen
 * bearable rather than confusing: each one **names its own topic** to a screen
 * reader, and an unknown id renders **nothing** rather than a button that opens
 * an empty modal. The second is the difference between a typo being a missing
 * affordance and a typo being a dead end the user blames themselves for.
 */

describe('HelpButton', () => {
  it('names its topic rather than being one of eight buttons called "Help"', () => {
    render(<HelpButton topic="schedule" />);
    expect(screen.getByRole('button', { name: 'Help: Schedules and timezones' })).toBeInTheDocument();
  });

  it('opens that topic, with its points and its doc link', () => {
    render(<HelpButton topic="task-actions" />);
    fireEvent.click(screen.getByRole('button', { name: /^Help:/ }));

    const topic = helpTopic('task-actions')!;
    expect(screen.getByRole('heading', { name: topic.title })).toBeInTheDocument();
    for (const point of topic.points) {
      expect(screen.getByText(point.label)).toBeInTheDocument();
    }
    const doc = screen.getByText('Read the full docs').closest('a');
    expect(doc).toHaveAttribute('href', topic.doc.url);
    expect(doc).toHaveAttribute('target', '_blank');
    expect(doc).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('offers the way back to everything else', () => {
    // A specific answer must not be a dead end — someone who opened the wrong
    // topic needs a route to the right one without hunting for another `?`.
    render(<HelpButton topic="filters" />);
    fireEvent.click(screen.getByRole('button', { name: /^Help:/ }));
    fireEvent.click(screen.getByRole('button', { name: /Browse all help/i }));
    expect(screen.getByText('Cronsole Help Center')).toBeInTheDocument();
  });

  it('renders nothing for a topic that does not exist', () => {
    const { container } = render(<HelpButton topic="not-a-real-topic" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('sourceTopicId', () => {
  it('prefers the exact source, subtype and all', () => {
    expect(sourceTopicId('TASKHUB_NATIVE:EXEC')).toBe('source:TASKHUB_NATIVE:EXEC');
    expect(sourceTopicId('TASKHUB_NATIVE:HTTP')).toBe('source:TASKHUB_NATIVE:HTTP');
    expect(sourceTopicId('WINDOWS_TASK_SCHEDULER')).toBe('source:WINDOWS_TASK_SCHEDULER');
    expect(sourceTopicId('CLAUDE_CODE')).toBe('source:CLAUDE_CODE');
  });

  it('falls back to the platform, then to the overview', () => {
    // A source added server-side before it is written up here must still open
    // something true. The same degradation `sourceLabel` performs — an unknown
    // key produces a real answer rather than a missing button.
    expect(sourceTopicId('TASKHUB_NATIVE:SOMETHING_NEW')).toBe('source:TASKHUB_NATIVE');
    expect(sourceTopicId('MACOS_LAUNCHD')).toBe('sources');
    expect(helpTopic(sourceTopicId('MACOS_LAUNCHD'))).toBeDefined();
  });
});
