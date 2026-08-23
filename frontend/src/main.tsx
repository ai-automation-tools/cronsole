import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard.tsx'
import BackendStatusBanner from './components/BackendStatusBanner.tsx'
import { ToastProvider } from './hooks/ToastProvider.tsx'
import { ConfirmProvider } from './hooks/ConfirmProvider.tsx'
import { AuthProvider } from './hooks/AuthProvider.tsx'
import { AuthGate } from './components/AuthGate.tsx'
import { migrateLegacyStorageKeys } from './utils/storageMigration.ts'
import { startSettingsSync } from './hooks/useSettings.ts'
import './index.css'

// Before anything reads a key: carry the login token, theme, settings and
// API-origin override across the TaskHub → Cronsole rename. Without this the
// rename would log the user out and reset their preferences.
migrateLegacyStorageKeys()

// Then follow the account rather than the origin. `localStorage` is scoped per
// origin, so the same install reached at localhost and over Tailscale used to
// hand the same person two different sidebars — collections followed them across
// (they are rows) and pins and saved views did not. This reads the account's
// copy before it is allowed to write one; see hooks/useSettings.ts.
startSettingsSync()

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <BackendStatusBanner />
              <AuthGate>
                <Dashboard />
              </AuthGate>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
