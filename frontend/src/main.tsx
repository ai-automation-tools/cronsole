import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard.tsx'
import BackendStatusBanner from './components/BackendStatusBanner.tsx'
import { ToastProvider } from './hooks/ToastProvider.tsx'
import { ConfirmProvider } from './hooks/ConfirmProvider.tsx'
import { AuthProvider } from './hooks/AuthProvider.tsx'
import { AuthGate } from './components/AuthGate.tsx'
import { migrateLegacyStorageKeys } from './utils/storageMigration.ts'
import './index.css'

// Before anything reads a key: carry the login token, theme, settings and
// API-origin override across the TaskHub → Cronsole rename. Without this the
// rename would log the user out and reset their preferences.
migrateLegacyStorageKeys()

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
