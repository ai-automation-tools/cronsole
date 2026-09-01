/**
 * Preflight for a prompt that will run **unattended**.
 *
 * Every rule here was paid for by a real failed run on 2026-08-25 (ROADMAP ›
 * Gemini usability, item E), and none of them is a Cronsole defect — which is
 * exactly why they belong at the moment the trigger is created rather than in a
 * run log afterwards. A scheduled agent fails at 03:00 to an empty room; the
 * only cheap moment is before it exists.
 *
 * **Warnings, never refusals.** Not one of these is certainly wrong: a prompt
 * may legitimately contain a question mark, a box-drawing character may be part
 * of the output format being asked for, and "send the report" may mean a channel
 * the agent already knows. A task manager that *refuses* a prompt it merely
 * dislikes is worse than one that mentions it — so this returns a list and the
 * caller renders it beside the field. Nothing here blocks a create.
 *
 * **One definition, and it is the server's** (§9). The form calls
 * `POST /api/tools/prompt-preflight` as you type, the same shape as the schedule
 * preview it sits beside; a second copy in the browser would be free to disagree
 * with the one an MCP-created trigger is judged by.
 */

/** A machine-readable code so a caller can suppress or style one kind. */
export type PromptWarningCode = 'question' | 'gutter' | 'unaddressed-email';

/**
 * The rules that actually run, in order.
 *
 * Returned beside the warnings so a caller can tell **"three rules looked and
 * found nothing"** from **"nothing looked"** — the same distinction §9 requires
 * of a refusal to convert a schedule. An empty warning list is otherwise
 * indistinguishable from a preflight that silently did nothing, and the second
 * is the one that gets shipped by accident.
 */
export const PROMPT_PREFLIGHT_RULES: PromptWarningCode[] = [
  'question',
  'gutter',
  'unaddressed-email'
];

export interface PromptWarning {
  code: PromptWarningCode;
  /** One sentence: what was seen, and what to do about it. */
  message: string;
}

/**
 * Characters that arrive by **pasting from something rendered** — a terminal
 * gutter, a diff, a chat bubble, a markdown blockquote drawn with box characters.
 *
 * The 2026-08-25 failure was `▎` repeated down the left of a pasted prompt: the
 * agent read the instruction as fragments and ignored most of it. The run
 * reported `completed`. Nothing about the trigger was wrong, and nothing on any
 * screen said the prompt was full of characters the author could not see.
 *
 * Zero-width and non-breaking characters are in the same list for the same
 * reason — they are invisible in the textarea and change what the model reads.
 */
const GUTTER_CHARS =
  // Block Elements + Box Drawing (the pasted gutter), then the invisible ones:
  // zero-width space / non-joiner / joiner, BOM, soft hyphen, non-breaking space.
  /[\u2580-\u259F\u2500-\u257F\u200B\u200C\u200D\uFEFF\u00AD\u00A0]/g;

/**
 * Phrases that hand a decision back to a person. A question mark is the strong
 * signal and these are the ones that stall without one — "let me know which" has
 * no `?` and is just as fatal at 03:00.
 */
const DEFERRAL_PHRASES = [
  'let me know',
  'would you like',
  'do you want',
  'should i',
  'shall i',
  'which one',
  'if you prefer',
  'confirm with me',
  'check with me',
  'ask me',
  'ask the user',
  'tell me which',
  'wait for my',
  'wait for your'
];

/** Words that mean the prompt intends to *send mail*, as opposed to write a file. */
const MAIL_INTENT = /\b(e-?mail(?:s|ed|ing)?|mail(?:s|ed|ing)?\b|send (?:it |the |a )?(?:report|digest|summary|results?)\b)/i;

/**
 * A recipient the agent can actually use: a literal address, or a
 * `{{placeholder}}` a template will fill at apply time. `{{` counts because a
 * template's prompt is authored here too, and warning about a blank a form is
 * about to fill would train the reader to ignore the panel.
 */
const HAS_RECIPIENT = /(@[\w.-]+\.\w{2,}|\{\{\s*\w+\s*\}\})/;

/** Unique, in the order first seen — so the message names characters, not a set. */
const distinct = (chars: string[]): string[] => [...new Set(chars)];

/**
 * Describe one invisible character in a way the reader can act on. `▎` can be
 * shown; a zero-width space cannot, and printing it would render an empty pair
 * of quotes that looks like a bug in the warning.
 */
const nameChar = (c: string): string => {
  const named: Record<string, string> = {
    '\u200B': 'a zero-width space',
    '\u200C': 'a zero-width non-joiner',
    '\u200D': 'a zero-width joiner',
    '\uFEFF': 'a byte-order mark',
    '\u00AD': 'a soft hyphen',
    '\u00A0': 'a non-breaking space'
  };
  return named[c] ?? `"${c}"`;
};

export function preflightPrompt(prompt: string): PromptWarning[] {
  const warnings: PromptWarning[] = [];
  const text = prompt ?? '';
  const lower = text.toLowerCase();

  // 1. A question, or a choice offered. Nobody answers it.
  const phrase = DEFERRAL_PHRASES.find(p => lower.includes(p));
  if (text.includes('?') || phrase) {
    warnings.push({
      code: 'question',
      message: phrase
        ? `This prompt says "${phrase}" — nobody is there to answer at the scheduled time, so the run stalls. Give the parameter, or tell the agent to pick one and say which it picked.`
        : 'This prompt asks a question. An unattended agent has nobody to answer it, so the run stalls — give the parameter, or tell it to choose and report the choice.'
    });
  }

  // 2. Characters pasted in from something rendered.
  const found = distinct(text.match(GUTTER_CHARS) ?? []);
  if (found.length) {
    warnings.push({
      code: 'gutter',
      message:
        `This prompt contains ${found.map(nameChar).join(', ')} — usually pasted in from a terminal, a diff or a chat bubble. ` +
        'The agent reads them as part of the instruction and can chop it into fragments it ignores. Retype or clean the prompt.'
    });
  }

  // 3. Told to send mail, with nowhere to send it.
  if (MAIL_INTENT.test(text) && !HAS_RECIPIENT.test(text)) {
    warnings.push({
      code: 'unaddressed-email',
      message:
        'This prompt asks the agent to send mail but names no recipient. Add the address (and the sender, if the tool needs one) — ' +
        'an agent that cannot address the message writes a file instead and still reports success.'
    });
  }

  return warnings;
}
