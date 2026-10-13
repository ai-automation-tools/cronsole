import { QuickLinksPanel } from '../components/sources/QuickLinksPanel';

/**
 * Quick links as a top-bar section. The panel is the one the Sources tab
 * shows when this item is switched off in Settings — one component, two homes.
 */
export const QuickLinksScreen = () => (
  <div className="animate-in fade-in duration-300 pb-20 max-w-6xl mx-auto desktop-zoom-125">
    <div className="mb-6">
      <h2 className="text-2xl font-bold mb-1">Quick Links</h2>
      <p className="text-muted-foreground">Bookmarks to schedulers Cronsole has no connector for.</p>
    </div>
    <QuickLinksPanel />
  </div>
);
