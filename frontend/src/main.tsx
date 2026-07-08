import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard.tsx'
import BackendStatusBanner from './components/BackendStatusBanner.tsx'
import { ToastProvider } from './hooks/ToastProvider.tsx'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BackendStatusBanner />
        <Dashboard />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
