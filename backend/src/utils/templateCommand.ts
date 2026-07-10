/**
 * Server-side template command resolution (P1 follow-up to the P0 structured-
 * command work). The Apply modal used to substitute {{placeholders}} into the
 * command string client-side and send the finished string; the backend then
 * tokenized that string, so a parameter value containing an unbalanced quote
 * could split into extra literal args (harmless without a shell, but not what
 * the template author wrote).
 *
 * Now the client sends raw parameter values and the backend owns substitution,
 * applied per-token over the *template*:
 *   - the template is tokenized first, with placeholders intact;
 *   - a placeholder inside a quoted or composite token ("{{scriptPath}}",
 *     --flag={{v}}) substitutes literally and is always exactly one argument,
 *     regardless of quotes/spaces in the value;
 *   - a bare unquoted token that is exactly one placeholder ({{args}}) is the
 *     author's "extra arguments" slot: its value is tokenized and may expand
 *     to zero or more arguments. The expansion is contained to that position -
 *     it can never merge into or split a neighboring template token.
 */

import {
  parseCommandTokens,
  parseCommandLine,
  StructuredAction
} from './commandParser.js';

/** Shape of one entry in Template.parameters (see docs Templates.md §5). */
export interface TemplateParameterDef {
  key: string;
  label?: string;
  type?: string; // 'text' | 'path' | 'url' | 'select' | ...
  default?: string;
  required?: boolean;
  options?: string[];
  help?: string;
}

/** Client/param errors -> HTTP 400 at the route layer. */
export class TemplateParamError extends Error {}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;
const BARE_PLACEHOLDER_RE = /^\{\{(\w+)\}\}$/;

/**
 * Validate raw parameter values against the template's parameter definitions
 * and return the complete substitution map (defaults filled in). Only declared
 * parameters may be provided, values must be strings, required parameters must
 * be non-blank, and select parameters must match one of their options.
 */
export function resolveTemplateParams(
  defs: unknown,
  provided: unknown
): Record<string, string> {
  const defList: TemplateParameterDef[] = Array.isArray(defs)
    ? (defs as TemplateParameterDef[]).filter(d => d && typeof d.key === 'string')
    : [];

  if (provided !== undefined && provided !== null &&
      (typeof provided !== 'object' || Array.isArray(provided))) {
    throw new TemplateParamError('`parameters` must be an object of { key: value } strings.');
  }
  const raw = (provided ?? {}) as Record<string, unknown>;

  const declared = new Set(defList.map(d => d.key));
  const unknown = Object.keys(raw).filter(k => !declared.has(k));
  if (unknown.length > 0) {
    throw new TemplateParamError(
      `Unknown parameter(s): ${unknown.join(', ')} — not declared by this template.`
    );
  }

  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const def of defList) {
    const v = raw[def.key];
    if (v !== undefined && typeof v !== 'string') {
      throw new TemplateParamError(`Parameter "${def.key}" must be a string.`);
    }
    const value = (v as string | undefined) ?? def.default ?? '';
    if (def.required && !value.trim()) {
      missing.push(def.key);
      continue;
    }
    if (def.type === 'select' && Array.isArray(def.options) && value.trim() &&
        !def.options.includes(value)) {
      throw new TemplateParamError(
        `Parameter "${def.key}" must be one of: ${def.options.join(', ')}.`
      );
    }
    values[def.key] = value;
  }
  if (missing.length > 0) {
    throw new TemplateParamError(
      `Missing required parameter(s): ${missing.join(', ')}.`
    );
  }
  return values;
}

/**
 * Quote a resolved argv back into a display string. Cosmetic/signature only -
 * the structured action is what the agent registers and executes.
 */
export function formatCommandLine(argv: string[]): string {
  return argv
    .map(a => (a === '' || /[\s"]/.test(a) ? `"${a}"` : a))
    .join(' ');
}

/**
 * Substitute values into a command template per-token and return the
 * structured action plus its display string. Throws TemplateParamError if a
 * placeholder has no value or the result has no executable.
 */
export function substituteStructuredCommand(
  commandTemplate: string,
  values: Record<string, string>
): { action: StructuredAction; command: string } {
  const unfilled = new Set<string>();
  const argv: string[] = [];

  for (const token of parseCommandTokens(commandTemplate)) {
    const bare = !token.quoted && BARE_PLACEHOLDER_RE.exec(token.text);
    if (bare) {
      const key = bare[1];
      if (key in values) {
        // Author's multi-argument slot: the value tokenizes in place and may
        // contribute zero or more args (an empty optional simply drops out).
        argv.push(...parseCommandLine(values[key]));
      } else {
        unfilled.add(key);
        argv.push(token.text);
      }
      continue;
    }
    // Literal substitution: the token stays exactly one argument. Unfilled
    // keys are tracked during the replace so a *value* that happens to
    // contain "{{...}}" text is treated as data, not a missing placeholder.
    argv.push(
      token.text.replace(PLACEHOLDER_RE, (match, key) => {
        if (key in values) return values[key];
        unfilled.add(key);
        return match;
      })
    );
  }

  if (unfilled.size > 0) {
    throw new TemplateParamError(
      `Command still contains unfilled placeholders: ${[...unfilled].join(', ')}.`
    );
  }
  if (argv.length === 0 || !argv[0].trim()) {
    throw new TemplateParamError('Template resolves to an empty command.');
  }
  return {
    action: { executable: argv[0], args: argv.slice(1) },
    command: formatCommandLine(argv)
  };
}

/**
 * Whole-string substitution for platforms that don't split a command into
 * argv (e.g. a TaskHub-native HTTP job, where the command is a URL). Same
 * unfilled-placeholder tracking as the structured variant.
 */
export function substitutePlainCommand(
  commandTemplate: string,
  values: Record<string, string>
): string {
  const unfilled = new Set<string>();
  const result = commandTemplate.replace(PLACEHOLDER_RE, (match, key) => {
    if (key in values) return values[key];
    unfilled.add(key);
    return match;
  });
  if (unfilled.size > 0) {
    throw new TemplateParamError(
      `Command still contains unfilled placeholders: ${[...unfilled].join(', ')}.`
    );
  }
  return result.trim();
}
