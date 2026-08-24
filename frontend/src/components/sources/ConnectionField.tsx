/**
 * One labelled input on a hand-composed connection panel.
 *
 * **One definition, extracted 2026-08-24** when Vercel became the third such
 * panel. Claude's and GitHub's copies were already byte-identical apart from a
 * comment, and a third would have made the drift certain rather than likely —
 * these fields hold live third-party credentials, so `type="password"` silently
 * regressing in one of three copies is the kind of divergence that looks fine in
 * review and shows up in someone's screen recording.
 *
 * Deliberately not a general form primitive. It knows exactly one layout — label
 * above, monospace input, hint below — because that is what all three panels
 * draw, and generalizing past its callers is how a shared component becomes a
 * configuration language.
 */
export const ConnectionField = ({
  label,
  hint,
  value,
  onChange,
  placeholder,
  secret
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Renders as a password field — for a live third-party credential. */
  secret?: boolean;
}) => (
  <label className="block">
    <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground">{label}</span>
    <input
      // type="password" on a token: these are the fields in the product holding
      // a live third-party credential, and they are typed into a tab someone may
      // well be screen-sharing.
      type={secret ? 'password' : 'text'}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="mt-1 w-full px-2.5 py-1.5 rounded-lg text-xs bg-surface border border-border text-foreground placeholder:text-subtle-foreground/60 focus:outline-none focus:border-primary font-mono"
    />
    <span className="text-[10px] text-subtle-foreground mt-1 block">{hint}</span>
  </label>
);

export default ConnectionField;
