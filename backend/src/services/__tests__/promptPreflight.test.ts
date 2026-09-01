import { describe, it, expect } from 'vitest';
import { preflightPrompt } from '../promptPreflight.js';

const codes = (p: string) => preflightPrompt(p).map(w => w.code);

/**
 * The three cases are the three real failures of 2026-08-25 (ROADMAP › Gemini
 * usability, item E). The clean cases matter as much: a warning panel that fires
 * on ordinary prompts is one the reader learns to ignore, and then it is worse
 * than nothing on the day it is right.
 */
describe('preflightPrompt', () => {
  it('says nothing about an ordinary unattended prompt', () => {
    expect(
      preflightPrompt(
        'Read https://example.com/changelog and summarize what changed in the last week. ' +
          'If the page cannot be loaded, say so explicitly rather than reporting no change.'
      )
    ).toEqual([]);
  });

  it('flags a question — nobody is there to answer it', () => {
    expect(codes('Summarize the news. Which topics should I include?')).toEqual(['question']);
  });

  it('flags a choice handed back without a question mark', () => {
    const [warning] = preflightPrompt('Draft the report and let me know which format you prefer.');
    expect(warning.code).toBe('question');
    // The message quotes what it saw, so the fix is locatable in a long prompt.
    expect(warning.message).toContain('let me know');
  });

  it('flags a pasted gutter, and names the character', () => {
    const [warning] = preflightPrompt('▎ Research the topic\n▎ and write it up.');
    expect(warning.code).toBe('gutter');
    expect(warning.message).toContain('▎');
  });

  it('names an invisible character rather than printing it', () => {
    const [warning] = preflightPrompt('Write the​report.');
    expect(warning.code).toBe('gutter');
    expect(warning.message).toContain('a zero-width space');
    // Printing it would render an empty pair of quotes that reads as a bug in
    // the warning itself.
    expect(warning.message).not.toContain('""');
  });

  it('flags mail with no recipient', () => {
    expect(codes('Research the topic and email the digest.')).toEqual(['unaddressed-email']);
  });

  it('accepts a literal address, and a placeholder a template will fill', () => {
    expect(codes('Research the topic and email the digest to ops@example.com.')).toEqual([]);
    expect(codes('Research the topic and email the digest to {{recipient}}.')).toEqual([]);
  });

  it('says nothing about a prompt that writes a file rather than sending mail', () => {
    expect(codes('Research the topic and write the digest to a file.')).toEqual([]);
  });

  it('reports every problem a prompt has, not the first', () => {
    expect(codes('▎ Email the digest. Should I include drafts?').sort()).toEqual(
      ['gutter', 'question', 'unaddressed-email'].sort()
    );
  });

  it('is a warning list and never throws on empty or absent input', () => {
    expect(preflightPrompt('')).toEqual([]);
    expect(preflightPrompt(undefined as unknown as string)).toEqual([]);
  });
});
