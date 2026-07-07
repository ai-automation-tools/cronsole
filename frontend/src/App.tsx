import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';
import BackendStatusBanner from './components/BackendStatusBanner';
import './App.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BackendStatusBanner />
      <Dashboard />
    </QueryClientProvider>
  );
}

export default App;
