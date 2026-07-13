import { useState, useMemo, useEffect, useRef, type ChangeEvent } from 'react';
import {
  Activity,
  LayoutDashboard,
  RefreshCw,
  Cpu,
  Library,
  Loader2,
  Info,
  Clock,
  ExternalLink,
  ArrowRight,
  Folder,
  Tag,
  Plus,
  Eye,
  EyeOff,
  Bot,
  Sparkles,
  Globe,
  Trash2,
  Grid,
  List,
  Columns,
  Star,
  Calendar,
  HelpCircle,
  CopyPlus,
  Play,
  Zap,
  Search,
  X,
  Download,
  Upload,
  BookOpen,
  ChevronDown
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CloneTaskModal } from './components/CloneTaskModal';
import { HelpModal } from './components/HelpModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task, Template, PlatformLink, ImportResult } from './types';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { ImportModal } from './components/ImportModal';
import { TaskCard } from './components/TaskCard';
import { ApplyTemplateModal } from './components/ApplyTemplateModal';
import { CreateTaskModal } from './components/CreateTaskModal';
import { platformLabel, platformBadgeClass, isCreatablePlatform } from './platform';
import { matchesTaskSearch } from './utils/taskSearch';
import { SettingsScreen } from './components/SettingsScreen';
import { useSettings, type Settings, type TemplateView } from './hooks/useSettings';
import { TEMPLATE_RESOURCES } from './data/templateResources';
import { useToast } from './hooks/useToast';
import { useConnections } from './hooks/useConnections';
import { useLiveTaskUpdates } from './hooks/useLiveTaskUpdates';
import { formatDateTime, formatTime, timeAgo } from './utils/datetime';

// Loose shape for the untyped platform-metadata JSON blob on tasks.
type TaskMeta = { nextRunTime?: string; nextRun?: string; schedule?: string } | null | undefined;

const DashboardScreen = ({
  onTaskSelect,
  onRun,
  tasks,
  isLoading,
  onImport,
  onSyncNow,
  isSyncing,
  onCategoryUpdate,
  onClone,
  onShowHelp,
  onNewTask,
  settings
}: {
  onTaskSelect: (task: Task) => void;
  onRun: (task: Task) => void;
  tasks: Task[] | undefined;
  isLoading: boolean;
  onImport: () => void;
  onSyncNow: () => void;
  isSyncing: boolean;
  onCategoryUpdate: (taskId: string, category: string) => void;
  onClone: (task: Task) => void;
  onShowHelp: () => void;
  onNewTask: () => void;
  settings: Settings;
}) => {
  const { data: connections } = useConnections();
  // "Last synced" = the most recent per-connection sync timestamp.
  const lastSync = useMemo(() => {
    const stamps = (connections ?? [])
      .map(c => c.lastSync)
      .filter((s): s is string => !!s)
      .sort();
    return stamps.length ? stamps[stamps.length - 1] : null;
  }, [connections]);
  // Initialize view/filter state from the user's saved dashboard defaults.
  const [selectedCategory, setSelectedTaskCategory] = useState<string>(settings.defaultCategory);
  const [selectedPlatform, setSelectedPlatform] = useState<string>(settings.defaultPlatform);
  const [showDisabled, setShowDisabled] = useState(settings.defaultShowDisabled);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'kanban' | 'schedule'>(settings.defaultView);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search (unless already typing somewhere); Escape clears it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && target === searchInputRef.current) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Apply the active/disabled filter the same way the task grid does (kanban
  // shows both columns, so it never hides disabled tasks).
  const applyActiveFilter = (list: Task[]) =>
    viewMode !== 'kanban' && !showDisabled ? list.filter(t => t.status === 'ACTIVE') : list;

  // Category chips are faceted: they reflect the active/disabled + platform
  // filters so an empty category (e.g. no *active* tasks in it) drops out
  // instead of showing a 0-count tag. The currently-selected category stays
  // pinned even if it empties, so the view doesn't jump out from under you.
  const { categories, categoryCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    if (tasks) {
      let base = applyActiveFilter(tasks);
      if (selectedPlatform !== 'All') base = base.filter(t => t.platform === selectedPlatform);
      for (const t of base) {
        const c = t.category || 'Uncategorized';
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      if (selectedCategory !== 'All' && !counts.has(selectedCategory)) counts.set(selectedCategory, 0);
    }
    return { categories: ['All', ...Array.from(counts.keys()).sort()], categoryCounts: counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, viewMode, showDisabled, selectedPlatform, selectedCategory]);

  // The "All" chip counts every task visible under the current active/platform
  // constraints — i.e. the sum of the per-category counts.
  const totalVisibleCount = useMemo(
    () => Array.from(categoryCounts.values()).reduce((sum, n) => sum + n, 0),
    [categoryCounts]
  );

  // Platform chips are faceted the same way (active/disabled + selected
  // category), but never filtered by the platform selection itself — you must
  // still be able to switch platforms. Keep the selected platform pinned.
  const { platforms, platformCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    if (tasks) {
      let base = applyActiveFilter(tasks);
      if (selectedCategory !== 'All') base = base.filter(t => (t.category || 'Uncategorized') === selectedCategory);
      for (const t of base) counts.set(t.platform, (counts.get(t.platform) ?? 0) + 1);
      if (selectedPlatform !== 'All' && !counts.has(selectedPlatform)) counts.set(selectedPlatform, 0);
    }
    return { platforms: Array.from(counts.keys()).sort(), platformCounts: counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, viewMode, showDisabled, selectedCategory, selectedPlatform]);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    // First apply the active/disabled filter (except for kanban view where we show both columns)
    let result = tasks;
    if (viewMode !== 'kanban') {
      result = showDisabled ? tasks : tasks.filter(t => t.status === 'ACTIVE');
    }

    // Platform isolation (e.g. only TaskHub-native, only Windows)
    if (selectedPlatform !== 'All') {
      result = result.filter(t => t.platform === selectedPlatform);
    }

    // Then apply category filter
    if (selectedCategory !== 'All') {
      result = result.filter(t => (t.category || 'Uncategorized') === selectedCategory);
    }

    // Finally, free-text search (name / category / path / command / schedule)
    if (searchQuery.trim()) {
      result = result.filter(t => matchesTaskSearch(t, searchQuery));
    }

    return result;
  }, [tasks, selectedCategory, selectedPlatform, showDisabled, viewMode, searchQuery]);

  const scheduledTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const aTime = (a.metadata as TaskMeta)?.nextRunTime || (a.metadata as TaskMeta)?.nextRun || a.updatedAt;
      const bTime = (b.metadata as TaskMeta)?.nextRunTime || (b.metadata as TaskMeta)?.nextRun || b.updatedAt;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
  }, [filteredTasks]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-foreground" size={48} />
        <p className="text-subtle-foreground font-medium animate-pulse">Fetching live tasks from agent...</p>
      </div>
    );
  }

  const isEmpty = !tasks || tasks.length === 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">Unified Task Dashboard</h2>
          <p className="text-muted-foreground">
            Manage {tasks?.length || 0} tasks across your ecosystem.
            {lastSync && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-subtle-foreground">
                <RefreshCw size={11} /> synced {timeAgo(lastSync)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={onShowHelp}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-all flex items-center gap-2 active:scale-95 shadow-md font-bold"
          >
            <HelpCircle size={16} /> Help Center
          </button>

          {!isEmpty && viewMode !== 'kanban' && (
            <button 
              onClick={() => setShowDisabled(!showDisabled)} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 border ${
                showDisabled 
                  ? 'bg-primary/10 border-primary/50 text-foreground' 
                  : 'bg-surface border-border text-muted-foreground hover:border-foreground/20'
              }`}
            >
              {showDisabled ? <Eye size={16} /> : <EyeOff size={16} />}
              {showDisabled ? 'Showing All' : 'Active Only'}
            </button>
          )}
          
          <button
            onClick={onNewTask}
            className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-violet-600/20 active:scale-95"
            title="Create a task that runs on TaskHub itself — no Windows entry"
          >
            <Zap size={16} /> New Task
          </button>

          <button
            onClick={onImport}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-surface border border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-all flex items-center gap-2 active:scale-95 shadow-md"
            title="Discover and import tasks from your connected platforms"
          >
            <Download size={16} /> Import
          </button>

          <button
            onClick={onSyncNow}
            disabled={isSyncing}
            className="bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Re-pull status and schedules for the tasks you already track"
          >
            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} /> {isSyncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-[50vh] border-2 border-dashed border-border rounded-3xl p-10 text-center">
           <Activity size={48} className="text-subtle-foreground mb-4 animate-pulse" />
           <h3 className="text-xl font-bold text-foreground">Dashboard is empty</h3>
           <p className="text-subtle-foreground max-w-sm mt-2 mb-6">
              Connect systems and perform your first sync to discover and monitor scheduled tasks.
           </p>
           <button
             onClick={onImport}
             className="bg-primary hover:bg-primary-hover px-6 py-3 rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 flex items-center gap-2"
           >
             <Download size={16} /> Import Tasks
           </button>
        </div>
      ) : (
        <>
          {/* Category Tabs & Views */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search tasks…  /"
                  className="w-44 focus:w-60 bg-surface border border-border rounded-xl pl-8 pr-7 py-1.5 text-xs font-medium text-foreground placeholder:text-subtle-foreground outline-none focus:border-primary transition-all shadow-md"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground transition-colors"
                    title="Clear search (Esc)"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {searchQuery.trim() && (
                <span className="text-[10px] font-bold text-subtle-foreground px-1">
                  {filteredTasks.length} match{filteredTasks.length === 1 ? '' : 'es'}
                </span>
              )}
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedTaskCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                    selectedCategory === cat 
                      ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/20' 
                      : 'bg-surface border-border text-muted-foreground hover:border-foreground/20'
                  }`}
                >
                  {cat === 'All' ? <LayoutDashboard size={12} className="inline mr-2" /> : <Folder size={12} className="inline mr-2" />}
                  {cat}
                  <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>
                    {cat === 'All' ? totalVisibleCount : categoryCounts.get(cat) ?? 0}
                  </span>
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-3 self-start sm:self-auto shrink-0">
            {/* Platform Isolation Filter */}
            {platforms.length > 1 && (
              <div className="flex bg-surface border border-border p-1 rounded-xl items-center shadow-md">
                <button
                  onClick={() => setSelectedPlatform('All')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedPlatform === 'All' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  All
                </button>
                {platforms.map(p => (
                  <button
                    key={p}
                    onClick={() => setSelectedPlatform(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      selectedPlatform === p
                        ? p === 'TASKHUB_NATIVE' ? 'bg-violet-600 text-white' : 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p === 'TASKHUB_NATIVE' && <Zap size={11} />}
                    {platformLabel(p)}
                    <span className={`px-1 py-0.5 rounded text-[9px] ${selectedPlatform === p ? 'bg-black/20' : 'bg-muted text-subtle-foreground'}`}>
                      {platformCounts.get(p) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* View Mode Toggle */}
            <div className="flex bg-surface border border-border p-1 rounded-xl items-center shadow-md shrink-0">
              <button 
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Grid size={12} /> Grid
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <List size={12} /> List
              </button>
              <button 
                onClick={() => setViewMode('kanban')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Columns size={12} /> Kanban
              </button>
              <button
                onClick={() => setViewMode('schedule')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'schedule' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Calendar size={12} /> Schedule
              </button>
            </div>
            </div>
          </div>

          {/* Grid View */}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
              {filteredTasks.length === 0 ? (
                <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl text-subtle-foreground">
                   <Tag size={48} className="mb-4 opacity-20" />
                   <p className="font-bold">No tasks found</p>
                   {searchQuery.trim() && (
                     <button
                       onClick={() => setSearchQuery('')}
                       className="mt-4 text-foreground hover:text-foreground text-sm font-bold underline underline-offset-4"
                     >
                       Clear search "{searchQuery.trim()}"
                     </button>
                   )}
                   {!showDisabled && tasks?.some(t => t.status !== 'ACTIVE' && (selectedCategory === 'All' || t.category === selectedCategory)) && (
                     <button 
                       onClick={() => setShowDisabled(true)}
                       className="mt-4 text-foreground hover:text-foreground text-sm font-bold underline underline-offset-4"
                     >
                       Show disabled tasks in this category
                     </button>
                   )}
                </div>
              ) : (
                filteredTasks.map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    onSelect={onTaskSelect} 
                    onRun={onRun} 
                    onCategoryUpdate={onCategoryUpdate} 
                    onClone={onClone}
                  />
                ))
              )}
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-2xl pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/80 text-[10px] uppercase font-black text-subtle-foreground tracking-wider bg-background/20">
                      <th className="py-4 px-6">Name</th>
                      <th className="py-4 px-4">Platform</th>
                      <th className="py-4 px-4">Category</th>
                      <th className="py-4 px-4">Status</th>
                      <th className="py-4 px-4">Last Sync</th>
                      <th className="py-4 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 text-sm">
                    {filteredTasks.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-subtle-foreground font-medium italic">
                          No tasks match the active filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTasks.map(task => (
                        <tr 
                          key={task.id} 
                          className="hover:bg-surface/50 transition-colors group cursor-pointer"
                          onClick={() => onTaskSelect(task)}
                        >
                          <td className="py-4 px-6 font-bold text-foreground group-hover:text-foreground transition-colors">
                            <div>
                              <span className="block truncate max-w-[240px]">{task.name}</span>
                              <span className="block text-[10px] text-subtle-foreground font-mono font-normal truncate max-w-[240px] mt-0.5">{task.externalId}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`text-[9px] uppercase font-black px-2.5 py-1 rounded-lg border ${platformBadgeClass(task.platform)}`}>
                              {platformLabel(task.platform)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                              <Folder size={12} className="text-subtle-foreground" /> {task.category || 'Uncategorized'}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 bg-background px-2 py-1 rounded-lg border border-border text-[10px] font-bold text-muted-foreground">
                                <span className={`h-1.5 w-1.5 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : 'bg-muted'}`}></span>
                                {task.status}
                              </span>
                              {task.lastRunStatus === 'FAILURE' && (
                                <span className="inline-flex items-center bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/30 text-[9px] font-black text-red-400 uppercase" title={task.lastRunAt ? `Failed ${new Date(task.lastRunAt).toLocaleString()}` : 'Last run failed'}>
                                  Run failed
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-xs text-muted-foreground font-mono">
                            {formatTime(task.updatedAt, settings.timezone)}
                          </td>
                          <td className="py-4 px-4" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => onClone(task)} 
                                className="bg-muted hover:bg-muted hover:text-foreground p-2 rounded-lg text-muted-foreground border border-border transition-all active:scale-90"
                                title="Clone Task"
                              >
                                <CopyPlus size={16} />
                              </button>
                              <button 
                                onClick={() => onRun(task)} 
                                className="bg-success hover:bg-success-hover p-2 rounded-lg text-success-foreground shadow-lg shadow-success/20 transition-all active:scale-90"
                                title="Run Task"
                              >
                                <Play size={16} fill="currentColor" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Kanban Board View */}
          {viewMode === 'kanban' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
              {/* Active Column */}
              <div className="bg-surface/40 border border-border/80 rounded-3xl p-5 flex flex-col space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500"></div>
                    <h3 className="font-bold text-sm tracking-wide text-foreground uppercase">Active Tasks</h3>
                  </div>
                  <span className="bg-background px-2 py-0.5 rounded-md border border-border text-xs font-bold text-muted-foreground">
                    {filteredTasks.filter(t => t.status === 'ACTIVE').length}
                  </span>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar pr-1">
                  {filteredTasks.filter(t => t.status === 'ACTIVE').length === 0 ? (
                    <p className="text-xs text-subtle-foreground italic text-center py-10">No active tasks in this category.</p>
                  ) : (
                    filteredTasks.filter(t => t.status === 'ACTIVE').map(task => (
                      <div 
                        key={task.id} 
                        onClick={() => onTaskSelect(task)}
                        className="bg-surface border border-border hover:border-primary/40 p-4 rounded-2xl cursor-pointer hover:-translate-y-0.5 active:translate-y-0 transition-all flex flex-col gap-2 shadow-lg"
                      >
                        <div className="flex justify-between items-start">
                          <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                            {platformLabel(task.platform)}
                          </span>
                          <span className="text-[9px] font-bold text-subtle-foreground flex items-center gap-1">
                            <Folder size={10} /> {task.category || 'Uncategorized'}
                          </span>
                        </div>
                        <h4 className="font-bold text-foreground text-sm truncate">{task.name}</h4>
                        <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                          <span className="text-[9px] text-subtle-foreground font-mono">
                            {formatTime(task.updatedAt, settings.timezone)}
                          </span>
                          <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                            <button 
                              onClick={() => onClone(task)} 
                              className="p-1.5 rounded bg-surface hover:bg-muted text-muted-foreground hover:text-foreground border border-border transition-all"
                              title="Clone Task"
                            >
                              <CopyPlus size={12} />
                            </button>
                            <button 
                              onClick={() => onRun(task)} 
                              className="p-1.5 rounded bg-success hover:bg-success-hover text-success-foreground transition-all shadow-md shadow-success/10"
                              title="Run Task"
                            >
                              <Play size={12} fill="currentColor" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Disabled Column */}
              <div className="bg-surface/40 border border-border/80 rounded-3xl p-5 flex flex-col space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-muted"></div>
                    <h3 className="font-bold text-sm tracking-wide text-muted-foreground uppercase">Disabled Tasks</h3>
                  </div>
                  <span className="bg-background px-2 py-0.5 rounded-md border border-border text-xs font-bold text-muted-foreground">
                    {filteredTasks.filter(t => t.status !== 'ACTIVE').length}
                  </span>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar pr-1">
                  {filteredTasks.filter(t => t.status !== 'ACTIVE').length === 0 ? (
                    <p className="text-xs text-subtle-foreground italic text-center py-10">No disabled tasks in this category.</p>
                  ) : (
                    filteredTasks.filter(t => t.status !== 'ACTIVE').map(task => (
                      <div 
                        key={task.id} 
                        onClick={() => onTaskSelect(task)}
                        className="bg-surface border border-border hover:border-primary/40 p-4 rounded-2xl cursor-pointer hover:-translate-y-0.5 active:translate-y-0 transition-all flex flex-col gap-2 shadow-lg opacity-60 hover:opacity-100"
                      >
                        <div className="flex justify-between items-start">
                          <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                            {platformLabel(task.platform)}
                          </span>
                          <span className="text-[9px] font-bold text-subtle-foreground flex items-center gap-1">
                            <Folder size={10} /> {task.category || 'Uncategorized'}
                          </span>
                        </div>
                        <h4 className="font-bold text-muted-foreground text-sm truncate">{task.name}</h4>
                        <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                          <span className="text-[9px] text-subtle-foreground font-mono">
                            {formatTime(task.updatedAt, settings.timezone)}
                          </span>
                          <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                            <button 
                              onClick={() => onClone(task)} 
                              className="p-1.5 rounded bg-surface hover:bg-muted text-muted-foreground hover:text-foreground border border-border transition-all"
                              title="Clone Task"
                            >
                              <CopyPlus size={12} />
                            </button>
                            <button 
                              onClick={() => onRun(task)} 
                              className="p-1.5 rounded bg-success hover:bg-success-hover text-success-foreground transition-all shadow-md shadow-success/10"
                              title="Run Task"
                            >
                              <Play size={12} fill="currentColor" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Schedule View */}
          {viewMode === 'schedule' && (
            <div className="space-y-4 pb-20">
              <div className="bg-surface/30 border border-border p-4 rounded-2xl text-xs text-muted-foreground flex items-center gap-2 max-w-xl">
                <Info size={16} className="text-foreground shrink-0" />
                This view orders tasks chronologically based on their next scheduled run or last update time.
              </div>
              
              <div className="relative border-l border-border ml-4 pl-6 space-y-6">
                {scheduledTasks.length === 0 ? (
                  <p className="text-sm text-subtle-foreground italic">No scheduled tasks found in this category.</p>
                ) : (
                  scheduledTasks.map(task => {
                    const nextRun = (task.metadata as TaskMeta)?.nextRunTime || (task.metadata as TaskMeta)?.nextRun || null;
                    const scheduleStr = task.schedule || (task.metadata as TaskMeta)?.schedule || 'No direct schedule';
                    return (
                      <div key={task.id} className="relative group">
                        {/* Timeline node */}
                        <div className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-muted border-2 border-border group-hover:bg-primary-hover transition-colors"></div>
                        
                        <div 
                          onClick={() => onTaskSelect(task)}
                          className="bg-surface border border-border hover:border-primary/30 p-5 rounded-2xl max-w-3xl cursor-pointer shadow-xl transition-all hover:bg-surface/80"
                        >
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-foreground text-base">{task.name}</h4>
                                <span className={`text-[8px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                                  {platformLabel(task.platform)}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground">
                                <span className="flex items-center gap-1"><Folder size={12} /> {task.category || 'Uncategorized'}</span>
                                <span className="flex items-center gap-1 font-mono text-foreground/80"><Clock size={12} /> {scheduleStr}</span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end border-t md:border-t-0 border-border/50 pt-2 md:pt-0">
                              <div className="text-right">
                                <span className="text-[10px] text-subtle-foreground block uppercase font-bold tracking-wider">Next Run Time</span>
                                <span className="text-xs text-foreground font-mono font-bold">
                                  {nextRun ? formatDateTime(nextRun, settings.timezone) : 'Not set / Manual'}
                                </span>
                              </div>
                              <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                                <button 
                                  onClick={() => onClone(task)} 
                                  className="p-2 rounded bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border transition-all active:scale-95"
                                  title="Clone Task"
                                >
                                  <CopyPlus size={14} />
                                </button>
                                <button 
                                  onClick={() => onRun(task)} 
                                  className="p-2 rounded bg-success hover:bg-success-hover text-success-foreground transition-all shadow-md shadow-success/10 active:scale-95"
                                  title="Run Task"
                                >
                                  <Play size={14} fill="currentColor" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Human labels for the enum-ish template facets (see backend/src/seed.ts).
const TEMPLATE_OS_LABELS: Record<string, string> = {
  WINDOWS: 'Windows',
  MACOS: 'macOS',
  LINUX: 'Linux',
  CROSS_PLATFORM: 'Cross-platform'
};
const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  BACKUP: 'Backup',
  AI_AGENT: 'AI Agent',
  CLEANUP: 'Cleanup',
  DEV_WORKFLOW: 'Dev Workflow',
  MONITORING: 'Monitoring',
  REPORTING: 'Reporting',
  MAINTENANCE: 'Maintenance',
  OTHER: 'Other'
};
const titleCaseEnum = (raw: string) =>
  raw.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const templateOsLabel = (os: string) => TEMPLATE_OS_LABELS[os] ?? titleCaseEnum(os);
const templateCategoryLabel = (c: string) => TEMPLATE_CATEGORY_LABELS[c] ?? titleCaseEnum(c);

type TemplateKind = 'all' | 'starters' | 'patterns';

const templateHaystack = (t: Template) =>
  [t.name, t.description, t.command, t.category, t.scriptType, t.os, ...(t.targetPlatforms ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const matchesTemplateSearch = (t: Template, query: string) => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = templateHaystack(t);
  return terms.every(term => hay.includes(term));
};

const byTemplateName = (a: Template, b: Template) => a.name.localeCompare(b.name);

// Favorites float to the top of a group, then alphabetical within each tier.
const byFavoriteThenName = (a: Template, b: Template) =>
  (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || byTemplateName(a, b);

// Count occurrences of a facet value across a list, pinning the selected value
// so it stays visible (as a 0-count chip) even after it's filtered everything out.
const buildTemplateFacet = (list: Template[], key: (t: Template) => string | undefined, pin: string) => {
  const counts = new Map<string, number>();
  for (const t of list) {
    const k = key(t);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (pin !== 'All' && !counts.has(pin)) counts.set(pin, 0);
  return counts;
};

const TemplateChip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
      active
        ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/20'
        : 'bg-surface border-border text-muted-foreground hover:border-foreground/20'
    }`}
  >
    {children}
  </button>
);

// Per-user favorite toggle (a star) shown on template cards/rows. Optimistic —
// the click flips template.isFavorite via the ['templates'] cache immediately.
const FavoriteStar = ({ template, onToggle, size = 16 }: { template: Template; onToggle: (t: Template) => void; size?: number }) => (
  <button
    onClick={e => { e.stopPropagation(); onToggle(template); }}
    aria-pressed={!!template.isFavorite}
    title={template.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    className={`shrink-0 transition-colors ${template.isFavorite ? 'text-amber-400 hover:text-amber-500' : 'text-subtle-foreground hover:text-amber-400'}`}
  >
    <Star size={size} className={template.isFavorite ? 'fill-current' : ''} />
  </button>
);

const TemplateCard = ({ template, onApply, onToggleFavorite }: { template: Template; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void }) => (
  <div className="bg-surface border border-border rounded-3xl overflow-hidden flex flex-col shadow-2xl transition-all hover:border-primary/30 group">
    <div className="p-6 flex-1">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          {template.isStarter && (
            <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-primary/15 text-foreground border border-primary/30 flex items-center gap-1">
              <Sparkles size={9} /> Starter
            </span>
          )}
          {template.scriptType && (
            <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              {template.scriptType.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <FavoriteStar template={template} onToggle={onToggleFavorite} size={18} />
      </div>

      <h3 className="text-xl font-bold mb-2 group-hover:text-foreground transition-colors">{template.name}</h3>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{template.description}</p>

      {/* "Compatible with" — honest framing: creatable platforms are highlighted,
          the rest are compatibility labels only (no agent/API yet), so the badges
          never imply a one-click export that silently fails. */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground">Compatible with</span>
        {template.targetPlatforms.map(p => {
          const creatable = isCreatablePlatform(p);
          return (
            <span
              key={p}
              title={creatable ? 'TaskHub can create this task here' : 'Compatible pattern — TaskHub can’t create tasks here yet'}
              className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-full border ${creatable ? 'bg-primary/15 text-foreground border-primary/30' : 'bg-muted text-subtle-foreground border-border opacity-70'}`}
            >
              {platformLabel(p)}{!creatable && ' *'}
            </span>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs bg-background p-3 rounded-2xl border border-border/50">
          <Clock size={14} className="text-foreground" />
          <code className="text-foreground font-mono">{template.scheduleExpression}</code>
          <span className="text-subtle-foreground italic ml-auto">UTC</span>
        </div>
        <div className="flex items-center gap-3 text-xs bg-background p-3 rounded-2xl border border-border/50">
          <ExternalLink size={14} className="text-purple-500" />
          <span className="truncate text-foreground italic">{template.command}</span>
        </div>
      </div>
    </div>

    <button onClick={() => onApply(template)} className="w-full bg-muted hover:bg-primary-hover text-foreground hover:text-primary-foreground py-4 font-bold flex items-center justify-center gap-2 transition-all border-t border-border group-hover:border-primary/20">
      Apply Template <ArrowRight size={16} />
    </button>
  </div>
);

// Compact single-line row used by the List view.
const TemplateListRow = ({ template, onApply, onToggleFavorite }: { template: Template; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void }) => (
  <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-4 hover:border-primary/30 transition-all">
    <FavoriteStar template={template} onToggle={onToggleFavorite} size={16} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap mb-0.5">
        <h4 className="text-sm font-bold text-foreground truncate">{template.name}</h4>
        {template.isStarter && (
          <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded-full bg-primary/15 text-foreground border border-primary/30">Starter</span>
        )}
        {template.scriptType && (
          <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">{template.scriptType.replace(/_/g, ' ')}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground truncate">{template.description}</p>
    </div>
    <code className="hidden sm:block text-[11px] font-mono text-subtle-foreground shrink-0">{template.scheduleExpression}</code>
    <button
      onClick={() => onApply(template)}
      className="shrink-0 bg-muted hover:bg-primary-hover text-foreground hover:text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border border-border"
    >
      Apply <ArrowRight size={13} />
    </button>
  </div>
);

const TemplateGroup = ({ icon: Icon, title, subtitle, templates, onApply, onToggleFavorite, view = 'grid' }: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  templates: Template[];
  onApply: (t: Template) => void;
  onToggleFavorite: (t: Template) => void;
  view?: 'grid' | 'list';
}) => {
  if (templates.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-foreground uppercase tracking-wider">
          <Icon size={15} /> {title}
          <span className="text-xs font-bold text-subtle-foreground bg-muted px-2 py-0.5 rounded-full">{templates.length}</span>
        </h3>
        <span className="text-xs text-subtle-foreground">{subtitle}</span>
      </div>
      {view === 'list' ? (
        <div className="space-y-2">
          {templates.map(t => <TemplateListRow key={t.id} template={t} onApply={onApply} onToggleFavorite={onToggleFavorite} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {templates.map(t => <TemplateCard key={t.id} template={t} onApply={onApply} onToggleFavorite={onToggleFavorite} />)}
        </div>
      )}
    </div>
  );
};

// Kanban lane card — compact vertical card stacked inside a category column.
const TemplateKanbanCard = ({ template, onApply, onToggleFavorite }: { template: Template; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void }) => (
  <div className="bg-background border border-border rounded-xl p-3 space-y-2 hover:border-primary/30 transition-all">
    <div className="flex items-start justify-between gap-2">
      <h4 className="text-sm font-bold text-foreground leading-tight">{template.name}</h4>
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        {template.isStarter && <Sparkles size={12} className="text-foreground" />}
        <FavoriteStar template={template} onToggle={onToggleFavorite} size={13} />
      </div>
    </div>
    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">{template.description}</p>
    <div className="flex items-center justify-between gap-2 pt-1">
      <code className="text-[10px] font-mono text-subtle-foreground truncate">{template.scheduleExpression}</code>
      <button onClick={() => onApply(template)} className="shrink-0 text-[11px] font-bold text-primary hover:text-primary-hover flex items-center gap-1">
        Apply <ArrowRight size={11} />
      </button>
    </div>
  </div>
);

// Kanban view: one lane per category (Tag), horizontally scrollable.
const TemplateKanban = ({ templates, onApply, onToggleFavorite }: { templates: Template[]; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void }) => {
  const lanes = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates) {
      const key = t.category ?? 'OTHER';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries())
      .map(([cat, items]) => ({ cat, items: [...items].sort(byFavoriteThenName) }))
      .sort((a, b) => templateCategoryLabel(a.cat).localeCompare(templateCategoryLabel(b.cat)));
  }, [templates]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-20">
      {lanes.map(lane => (
        <div key={lane.cat} className="shrink-0 w-72 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Tag size={11} /> {templateCategoryLabel(lane.cat)}
            </h3>
            <span className="text-[10px] font-bold text-subtle-foreground bg-muted px-1.5 py-0.5 rounded-full">{lane.items.length}</span>
          </div>
          <div className="space-y-3">
            {lane.items.map(t => <TemplateKanbanCard key={t.id} template={t} onApply={onApply} onToggleFavorite={onToggleFavorite} />)}
          </div>
        </div>
      ))}
    </div>
  );
};

// Templates-tab view switcher (persisted to settings.templateView).
const TEMPLATE_VIEWS: { id: TemplateView; label: string; icon: LucideIcon }[] = [
  { id: 'grid', label: 'Grid', icon: Grid },
  { id: 'list', label: 'List', icon: List },
  { id: 'kanban', label: 'Kanban', icon: Columns }
];
const TemplateViewToggle = ({ view, onChange }: { view: TemplateView; onChange: (v: TemplateView) => void }) => (
  <div className="flex bg-surface border border-border p-1 rounded-xl items-center shadow-md shrink-0">
    {TEMPLATE_VIEWS.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${view === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <Icon size={12} /> {label}
      </button>
    ))}
  </div>
);

// Templates-tab "Resources" dropdown — curated external links (see data/templateResources.ts).
const TemplateResourcesMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-surface border border-border px-3 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground transition-all shadow-md"
      >
        <BookOpen size={13} /> Resources <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-surface border border-border rounded-2xl shadow-2xl z-50 p-2">
          {TEMPLATE_RESOURCES.map(section => (
            <div key={section.title} className="px-1 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground px-2 mb-1">{section.title}</p>
              <div className="space-y-0.5">
                {section.links.map(link => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-2 py-1.5 rounded-lg hover:bg-background transition-colors group/link"
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      {link.label}
                      <ExternalLink size={11} className="text-subtle-foreground opacity-0 group-hover/link:opacity-100 transition-opacity" />
                    </div>
                    {link.description && <p className="text-[11px] text-subtle-foreground leading-snug">{link.description}</p>}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Export the catalog to a JSON file / import a Registry v1 JSON file back in.
// Export goes through the api client (not a bare <a href>) so the auth header
// rides along; import posts the parsed file and reports a per-item summary.
const TemplateImportExport = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleExport = async () => {
    setBusy('export');
    try {
      const res = await api.get('/templates/export', { responseType: 'blob' });
      const cd = res.headers['content-disposition'] as string | undefined;
      const filename = cd?.match(/filename="?([^"]+)"?/)?.[1] ?? 'taskhub-catalog.json';
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Catalog exported.', 'success');
    } catch {
      toast('Export failed — is the backend running?', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setBusy('import');
    try {
      const json = JSON.parse(await file.text());
      const res = await api.post('/templates/import', json);
      summarizeImport(res.data, toast);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    } catch (err) {
      const anyErr = err as { response?: { data?: ImportResult }; name?: string };
      if (anyErr.response?.data) {
        // 400 from the server (nothing imported / all invalid) — show why.
        summarizeImport(anyErr.response.data, toast);
        queryClient.invalidateQueries({ queryKey: ['templates'] });
      } else if (err instanceof SyntaxError) {
        toast('Import failed — that file is not valid JSON.', 'error');
      } else {
        toast('Import failed — is the backend running?', 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleExport}
        disabled={busy !== null}
        className="flex items-center gap-1.5 bg-surface border border-border px-3 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground transition-all shadow-md disabled:opacity-50"
        title="Download the template catalog as JSON"
      >
        {busy === 'export' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        className="flex items-center gap-1.5 bg-surface border border-border px-3 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground transition-all shadow-md disabled:opacity-50"
        title="Import templates from a JSON file"
      >
        {busy === 'import' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
};

/** Turn an /templates/import result into a single honest toast. */
function summarizeImport(
  result: ImportResult,
  toast: (message: string, type?: 'success' | 'error') => void
): void {
  const imported = result.created.length + result.updated.length;
  const parts: string[] = [];
  if (result.created.length) parts.push(`${result.created.length} added`);
  if (result.updated.length) parts.push(`${result.updated.length} updated`);
  if (result.errors.length) parts.push(`${result.errors.length} skipped`);
  const summary = parts.length ? parts.join(', ') : 'nothing to import';

  if (imported === 0) {
    const first = result.errors[0]?.error;
    toast(`Import failed: ${first ?? summary}.`, 'error');
    return;
  }
  const detail = result.errors.length ? ` (first issue: ${result.errors[0].error})` : '';
  toast(`Imported ${summary}.${detail}`, result.errors.length ? 'error' : 'success');
}

const TemplatesScreen = () => {
  const [applyTarget, setApplyTarget] = useState<Template | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<TemplateKind>('all');
  const [selectedOs, setSelectedOs] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const { settings, update } = useSettings();
  const view = settings.templateView;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      try {
        const response = await api.get('/templates');
        return response.data;
      } catch (err) {
        console.error('Failed to fetch templates:', err);
        return [];
      }
    }
  });

  // Toggle a per-user favorite. Optimistic: flip isFavorite in the ['templates']
  // cache immediately (snappy star), roll back on error, then reconcile on settle.
  const favoriteMutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) =>
      next ? api.post(`/templates/${id}/favorite`) : api.delete(`/templates/${id}/favorite`),
    onMutate: async ({ id, next }) => {
      await queryClient.cancelQueries({ queryKey: ['templates'] });
      const prev = queryClient.getQueryData<Template[]>(['templates']);
      queryClient.setQueryData<Template[]>(['templates'], old =>
        (old ?? []).map(t => (t.id === id ? { ...t, isFavorite: next } : t)));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['templates'], ctx.prev);
      toast('Could not update favorite — try again.', 'error');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['templates'] })
  });
  const toggleFavorite = (t: Template) => favoriteMutation.mutate({ id: t.id, next: !t.isFavorite });

  const all = useMemo(() => templates ?? [], [templates]);

  // Narrow by the "kind" toggle + search first; the OS/category facets and the
  // final grid all build off this so counts reflect the current constraints.
  const searchKindFiltered = useMemo(() => {
    let list = all;
    if (kind === 'starters') list = list.filter(t => t.isStarter);
    else if (kind === 'patterns') list = list.filter(t => !t.isStarter);
    if (favoritesOnly) list = list.filter(t => t.isFavorite);
    if (search.trim()) list = list.filter(t => matchesTemplateSearch(t, search));
    return list;
  }, [all, kind, favoritesOnly, search]);

  // Faceted OS / category chips: each reflects the other's current selection so
  // an empty combination drops out instead of showing a 0-count tag.
  const osFacets = useMemo(
    () => buildTemplateFacet(
      selectedCategory === 'All' ? searchKindFiltered : searchKindFiltered.filter(t => t.category === selectedCategory),
      t => t.os,
      selectedOs
    ),
    [searchKindFiltered, selectedCategory, selectedOs]
  );
  const categoryFacets = useMemo(
    () => buildTemplateFacet(
      selectedOs === 'All' ? searchKindFiltered : searchKindFiltered.filter(t => t.os === selectedOs),
      t => t.category,
      selectedCategory
    ),
    [searchKindFiltered, selectedOs, selectedCategory]
  );

  const filtered = useMemo(() => {
    let list = searchKindFiltered;
    if (selectedOs !== 'All') list = list.filter(t => (t.os ?? '') === selectedOs);
    if (selectedCategory !== 'All') list = list.filter(t => (t.category ?? '') === selectedCategory);
    return list;
  }, [searchKindFiltered, selectedOs, selectedCategory]);

  const starters = useMemo(() => filtered.filter(t => t.isStarter).sort(byFavoriteThenName), [filtered]);
  const patterns = useMemo(() => filtered.filter(t => !t.isStarter).sort(byFavoriteThenName), [filtered]);

  const osValues = useMemo(() => Array.from(osFacets.keys()).sort((a, b) => templateOsLabel(a).localeCompare(templateOsLabel(b))), [osFacets]);
  const categoryValues = useMemo(() => Array.from(categoryFacets.keys()).sort((a, b) => templateCategoryLabel(a).localeCompare(templateCategoryLabel(b))), [categoryFacets]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-foreground" size={48} />
        <p className="text-subtle-foreground font-medium">Loading templates...</p>
      </div>
    );
  }

  const hasTemplates = all.length > 0;
  const favoriteCount = all.filter(t => t.isFavorite).length;
  const hasActiveFilters = kind !== 'all' || selectedOs !== 'All' || selectedCategory !== 'All' || favoritesOnly || !!search.trim();
  const clearFilters = () => { setSearch(''); setKind('all'); setSelectedOs('All'); setSelectedCategory('All'); setFavoritesOnly(false); };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold mb-1">Schedule Template Library</h2>
          <p className="text-muted-foreground">Prebuilt automation patterns for any platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <TemplateImportExport />
          <TemplateResourcesMenu />
          {hasTemplates && <TemplateViewToggle view={view} onChange={v => update('templateView', v)} />}
        </div>
      </div>

      {!hasTemplates ? (
        <div className="flex flex-col items-center justify-center h-[40vh] border-2 border-dashed border-border rounded-3xl p-10 text-center">
          <Library size={48} className="text-subtle-foreground mb-4" />
          <h3 className="text-xl font-bold text-foreground">No templates found</h3>
          <p className="text-subtle-foreground max-w-sm mt-2">
            The template library is currently empty. Run <code className="bg-surface px-2 py-1 rounded text-foreground">npm run seed</code> in backend.
          </p>
        </div>
      ) : (
        <>
          {/* Filter bar: search + Type / OS / Category facets */}
          <div className="bg-surface border border-border rounded-2xl p-4 space-y-4 shadow-md">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && setSearch('')}
                  placeholder="Search templates by name, command, category…"
                  className="w-full bg-background border border-border rounded-xl pl-9 pr-9 py-2 text-sm outline-none focus:border-primary transition-colors"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground" title="Clear search">
                    <X size={15} />
                  </button>
                )}
              </div>
              <button
                onClick={() => setFavoritesOnly(v => !v)}
                title={favoritesOnly ? 'Show all templates' : 'Show favorites only'}
                aria-pressed={favoritesOnly}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${favoritesOnly ? 'bg-amber-400/15 text-amber-500 border-amber-400/40' : 'bg-background text-muted-foreground border-border hover:text-foreground'}`}
              >
                <Star size={13} className={favoritesOnly ? 'fill-current' : ''} /> Favorites
                {favoriteCount > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${favoritesOnly ? 'bg-amber-400/20' : 'bg-muted text-subtle-foreground'}`}>{favoriteCount}</span>
                )}
              </button>
              <div className="flex items-center gap-1.5 bg-background border border-border p-1 rounded-xl shrink-0">
                {(['all', 'starters', 'patterns'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs font-bold text-subtle-foreground hover:text-foreground flex items-center gap-1 shrink-0" title="Clear all filters">
                  <X size={13} /> Clear
                </button>
              )}
            </div>

            {osValues.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground w-16 shrink-0">OS</span>
                <TemplateChip active={selectedOs === 'All'} onClick={() => setSelectedOs('All')}>All</TemplateChip>
                {osValues.map(os => (
                  <TemplateChip key={os} active={selectedOs === os} onClick={() => setSelectedOs(os)}>
                    {templateOsLabel(os)}
                    <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedOs === os ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>{osFacets.get(os) ?? 0}</span>
                  </TemplateChip>
                ))}
              </div>
            )}

            {categoryValues.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground w-16 shrink-0 flex items-center gap-1"><Tag size={10} /> Tags</span>
                <TemplateChip active={selectedCategory === 'All'} onClick={() => setSelectedCategory('All')}>All</TemplateChip>
                {categoryValues.map(cat => (
                  <TemplateChip key={cat} active={selectedCategory === cat} onClick={() => setSelectedCategory(cat)}>
                    {templateCategoryLabel(cat)}
                    <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>{categoryFacets.get(cat) ?? 0}</span>
                  </TemplateChip>
                ))}
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[30vh] border-2 border-dashed border-border rounded-3xl p-10 text-center">
              <Search size={40} className="text-subtle-foreground mb-4" />
              <h3 className="text-lg font-bold text-foreground">No templates match your filters</h3>
              <p className="text-subtle-foreground max-w-sm mt-2 mb-4">Try a different search or clear the filters to see all {all.length} templates.</p>
              <button onClick={clearFilters} className="text-sm font-bold text-primary hover:text-primary-hover flex items-center gap-1.5">
                <X size={15} /> Clear filters
              </button>
            </div>
          ) : view === 'kanban' ? (
            <TemplateKanban templates={filtered} onApply={setApplyTarget} onToggleFavorite={toggleFavorite} />
          ) : (
            <div className="space-y-10 pb-20">
              <TemplateGroup view={view} icon={Sparkles} title="Starters" subtitle="Parameterized building blocks — fill in the blanks and apply." templates={starters} onApply={setApplyTarget} onToggleFavorite={toggleFavorite} />
              <TemplateGroup view={view} icon={Library} title="Use-case patterns" subtitle="Ready-made automations for common jobs." templates={patterns} onApply={setApplyTarget} onToggleFavorite={toggleFavorite} />
            </div>
          )}
        </>
      )}

      {applyTarget && (
        <ApplyTemplateModal template={applyTarget} onClose={() => setApplyTarget(null)} />
      )}
    </div>
  );
};

const PlatformsScreen = () => {
  const [links, setLinks] = useState<PlatformLink[]>(() => {
    const saved = localStorage.getItem('taskhub_platform_links');
    if (saved) return JSON.parse(saved);
    return [
      { id: 'claude', name: 'Claude Routines', url: 'https://claude.ai/code/routines', iconType: 'claude' },
      { id: 'chatgpt', name: 'ChatGPT Schedules', url: 'https://chatgpt.com/schedules', iconType: 'chatgpt' },
      { id: 'gemini', name: 'Gemini Scheduled', url: 'https://gemini.google.com/scheduled', iconType: 'gemini' },
    ];
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const saveLinks = (newLinks: PlatformLink[]) => {
    setLinks(newLinks);
    localStorage.setItem('taskhub_platform_links', JSON.stringify(newLinks));
  };

  const addLink = () => {
    if (!newName || !newUrl) return;
    const newLink: PlatformLink = {
      id: Date.now().toString(),
      name: newName,
      url: newUrl.startsWith('http') ? newUrl : `https://${newUrl}`,
      iconType: 'custom'
    };
    saveLinks([...links, newLink]);
    setNewName('');
    setNewUrl('');
    setShowAdd(false);
  };

  const deleteLink = (id: string) => {
    saveLinks(links.filter(l => l.id !== id));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold mb-1">Platform Schedulers</h2>
          <p className="text-muted-foreground">Quick access to 3rd party task management interfaces.</p>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="bg-primary hover:bg-primary-hover px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95"
        >
          <Plus size={16} /> Add Custom Link
        </button>
      </div>

      {showAdd && (
        <div className="bg-surface border border-border p-6 rounded-2xl space-y-4 animate-in slide-in-from-top-2 max-w-4xl">
          <h3 className="text-sm font-bold uppercase tracking-widest text-subtle-foreground">New Platform Link</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-subtle-foreground ml-1">PLATFORM NAME</label>
              <input 
                type="text" 
                placeholder="e.g. N8N, OpenClaw"
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-subtle-foreground ml-1">URL</label>
              <input 
                type="text" 
                placeholder="https://..."
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={addLink} className="bg-primary hover:bg-primary-hover px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-primary/20">Save Platform</button>
          </div>
        </div>
      )}

      <div className="space-y-10">
        {/* Default Platforms Section */}
        <section className="space-y-4">
          <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em] ml-1">Official Schedulers</h3>
          <div className="flex flex-col gap-3 max-w-4xl">
            {links.filter(l => l.iconType !== 'custom').map(link => (
              <PlatformRow key={link.id} link={link} onDelete={deleteLink} />
            ))}
          </div>
        </section>

        {/* Custom Links Section */}
        {links.some(l => l.iconType === 'custom') && (
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em] ml-1">User Defined</h3>
            <div className="flex flex-col gap-3 max-w-4xl">
              {links.filter(l => l.iconType === 'custom').map(link => (
                <PlatformRow key={link.id} link={link} onDelete={deleteLink} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

const PlatformRow = ({ link, onDelete }: { link: PlatformLink; onDelete: (id: string) => void }) => {
  const getIcon = (type: string) => {
    switch (type) {
      case 'claude': return <Bot size={20} />;
      case 'chatgpt': return <Cpu size={20} />;
      case 'gemini': return <Sparkles size={20} />;
      default: return <Globe size={20} />;
    }
  };

  return (
    <div className="relative group">
      <a 
        href={link.url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="bg-surface border border-border p-4 rounded-2xl flex items-center gap-6 hover:border-primary/50 hover:bg-surface/50 transition-all shadow-xl group/card"
      >
        <div className={`p-3 rounded-xl flex-shrink-0 ${
          link.iconType === 'claude' ? 'bg-purple-500/10 text-purple-400' : 
          link.iconType === 'chatgpt' ? 'bg-green-500/10 text-green-400' :
          link.iconType === 'gemini' ? 'bg-primary/10 text-foreground' :
          'bg-muted/10 text-muted-foreground'
        }`}>
          {getIcon(link.iconType)}
        </div>
        
        <div className="flex-1 flex items-center justify-between min-w-0">
          <div className="min-w-0">
            <h3 className="font-bold text-lg text-foreground truncate group-hover/card:text-foreground transition-colors">{link.name}</h3>
            <p className="text-xs text-subtle-foreground truncate font-mono mt-0.5">{link.url}</p>
          </div>
          
          <div className="flex items-center gap-4 text-subtle-foreground group-hover/card:text-foreground transition-all">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-0 group-hover/card:opacity-100 transition-opacity">Open Dashboard</span>
            <ExternalLink size={18} />
          </div>
        </div>
      </a>
      
      {link.iconType === 'custom' && (
        <button 
          onClick={(e) => { e.preventDefault(); onDelete(link.id); }}
          className="absolute -right-3 top-1/2 -translate-y-1/2 p-2 bg-background border border-border rounded-full text-subtle-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shadow-lg z-10"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [cloningTask, setCloningTask] = useState<Task | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCreateNative, setShowCreateNative] = useState(false);
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const { toast } = useToast();

  // Push-based live updates: refresh the task list when the backend signals a
  // change (agent sync, scheduled run, another tab), instead of only polling.
  useLiveTaskUpdates();

  // Raise an OS notification for a task failure when the user has opted in.
  const notifyFailure = (title: string, body: string) => {
    if (settings.desktopNotifyOnFailure && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  };

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: async () => {
      const response = await api.get('/tasks');
      return response.data;
    }
  });

  const runMutation = useMutation({
    mutationFn: async (task: Task) => {
      if (settings.confirmBeforeRun && !confirm(`Are you sure you want to run task "${task.name}"?`)) {
        throw new Error('Cancelled');
      }
      await api.post(`/tasks/${task.id}/run`);
      return { task };
    },
    onSuccess: ({ task }) => {
      if (settings.toastOnSuccess) {
        toast(`"${task.name}" triggered successfully.`, 'success');
      }
    },
    onError: (error: unknown, task) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      if (err.message === 'Cancelled') return;
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Failed to run "${task.name}": ${detail}`, 'error');
      notifyFailure('TaskHub — run failed', `${task.name}: ${detail}`);
    }
  });

  const syncMutation = useMutation({
    mutationFn: async (categories: string[]) => {
      // 1. Ensure we have an active connection for Windows
      await api.get('/tasks/health'); // This route is often used to probe/refresh connections, 
                                     // but let's be more explicit.
      
      return api.post('/tasks/sync', { categories });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setShowImport(false);
      if (settings.toastOnSuccess) toast('Tasks synced.', 'success');
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Sync error: ${detail}`, 'error');
      notifyFailure('TaskHub — sync failed', detail);
    }
  });

  // Effect to ensure at least one connection exists for MVP (Windows)
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await api.get('/tasks/health');
        if (res.data.length === 0) {
          console.log('No connections found. Creating default Windows connection...');
          // This is a bit of a hack for MVP, ideally we have a proper onboarding flow
          // but for now, we'll trigger a 'health' check which we'll update in backend 
          // to auto-create if missing for the placeholder user.
        }
      } catch (e) {
        console.error('Failed to check connections', e);
      }
    };
    checkConnection();
  }, []);

  const categoryMutation = useMutation({
    mutationFn: async ({ taskId, category }: { taskId: string; category: string }) => {
      return api.patch(`/tasks/${taskId}`, { category });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const handleCategoryUpdate = (taskId: string, category: string) => {
    categoryMutation.mutate({ taskId, category });
  };

  return (
    <div className="flex h-screen bg-background text-foreground font-sans selection:bg-primary/30 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 p-10 overflow-y-auto">
        {activeTab === 'dashboard' && (
          <DashboardScreen
            tasks={tasks}
            isLoading={isLoading}
            onImport={() => setShowImport(true)}
            onSyncNow={() => {
              const cats = Array.from(new Set((tasks ?? []).map(t => t.category || 'Uncategorized')));
              syncMutation.mutate(cats);
            }}
            isSyncing={syncMutation.isPending}
            onTaskSelect={setSelectedTask}
            onRun={runMutation.mutate}
            onCategoryUpdate={handleCategoryUpdate}
            onClone={setCloningTask}
            onShowHelp={() => setShowHelp(true)}
            onNewTask={() => setShowCreateNative(true)}
            settings={settings}
          />
        )}
        {activeTab === 'templates' && <TemplatesScreen />}
        {activeTab === 'platforms' && <PlatformsScreen />}
        {activeTab === 'settings' && <SettingsScreen tasks={tasks} />}
      </main>
      <TaskModal 
        task={(tasks || []).find(t => t.id === selectedTask?.id) || selectedTask} 
        onClose={() => setSelectedTask(null)} 
        onRun={runMutation.mutate} 
        onCategoryUpdate={handleCategoryUpdate}
      />
      {cloningTask && (
        <CloneTaskModal 
          task={cloningTask} 
          onClose={() => setCloningTask(null)} 
        />
      )}
      {showHelp && (
        <HelpModal 
          onClose={() => setShowHelp(false)} 
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={syncMutation.mutate}
        />
      )}
      {showCreateNative && (
        <CreateTaskModal
          onClose={() => setShowCreateNative(false)}
        />
      )}
    </div>
  );
};

export default Dashboard;
