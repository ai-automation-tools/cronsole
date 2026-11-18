import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useTheme } from '../hooks/useTheme';
import { EMBED_PARENT, shellTheme, tellShell } from '../utils/embed';

/**
 * Inside the suite shell (`?embed=1` in a frame): says `ready` once, reports every
 * route change, and applies the shell's theme. Renders nothing, and does nothing
 * standalone. Mounted above `AuthGate`, so the login screen is embedded too.
 */
export function SuiteEmbed() {
  const { pathname, search } = useLocation();
  const { setTheme } = useTheme();

  useEffect(() => {
    if (!EMBED_PARENT) return;
    tellShell(EMBED_PARENT, { type: 'ready', app: 'cronsole' });
    const onMessage = (e: MessageEvent) => {
      const theme = shellTheme(e, EMBED_PARENT);
      if (theme) setTheme(theme);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setTheme]);

  useEffect(() => {
    if (EMBED_PARENT) tellShell(EMBED_PARENT, { type: 'route', path: pathname + search });
  }, [pathname, search]);

  return null;
}
