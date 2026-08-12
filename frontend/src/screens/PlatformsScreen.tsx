import { useState } from 'react';
import { Plus, Bot, Cpu, Sparkles, Globe, ExternalLink, Trash2 } from 'lucide-react';
import type { PlatformLink } from '../types';

export const PlatformsScreen = () => {
  const [links, setLinks] = useState<PlatformLink[]>(() => {
    const saved = localStorage.getItem('cronsole_platform_links');
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
    localStorage.setItem('cronsole_platform_links', JSON.stringify(newLinks));
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
          link.iconType === 'claude' ? 'bg-claude/10 text-claude-text' :
          link.iconType === 'chatgpt' ? 'bg-success/10 text-success-text' :
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
          className="absolute -right-3 top-1/2 -translate-y-1/2 p-2 bg-background border border-border rounded-full text-subtle-foreground hover:text-danger-text opacity-0 group-hover:opacity-100 transition-all shadow-lg z-10"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
