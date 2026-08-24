#!/usr/bin/env node
// The one definition of "credential-shaped literal".
//
// Two guards scan two completely different populations for the same thing:
//
//   frontend/scripts/check-bundle-secrets.mjs  ->  the BUILD OUTPUT (dist/)
//   scripts/check-tracked-env.mjs              ->  every git-TRACKED .env* file
//
// They are separate checks because the failure modes are unrelated - one is "Vite
// inlined a value nobody committed", the other is "somebody committed a value" -
// but the pattern list is the same fact stated once, so adding a provider here
// covers both surfaces. A second copy is how one of them quietly falls a year
// behind the other.
//
// Deliberately tight rather than broad: `re` must match the credential itself,
// not any long opaque string. Source maps, inlined assets and base64 icons are
// full of high-entropy blobs, and a looser pattern gets ignored within a week.

export const CREDENTIAL_PATTERNS = [
  {
    name: 'JSON Web Token',
    // header.payload - a JWT header always base64s to this prefix, so this is the
    // token itself rather than any long base64 string.
    re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/g
  },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-|svc-|admin-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Stripe secret key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { name: 'HuggingFace token', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { name: 'Groq API key', re: /\bgsk_[A-Za-z0-9]{40,}\b/g },
  { name: 'SendGrid API key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Neon / Postgres role password', re: /\bnpg_[A-Za-z0-9]{16,}\b/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g }
];

/** Every finding in `text`, as { name, sample }. */
export function scanForCredentials(text) {
  const findings = [];
  for (const { name, re } of CREDENTIAL_PATTERNS) {
    for (const match of text.matchAll(re)) {
      findings.push({ name, sample: match[0].slice(0, 24) });
    }
  }
  return findings;
}
