import { Star } from 'lucide-react';
import type { Task } from '../types';

interface TaskFavoriteStarProps {
  task: Task;
  onToggle: (task: Task) => void;
  size?: number;
  className?: string;
}

/**
 * The per-user star on a task. Mirrors the Templates tab's `FavoriteStar` —
 * same amber, same fill-when-on, same `aria-pressed` — because it is the same
 * gesture, and two stars that behaved differently would be two features.
 *
 * `stopPropagation` is not optional here: every surface this appears on (card,
 * list row, kanban card, timeline entry) opens the detail modal on click, so
 * without it starring a task also opens it.
 */
export const TaskFavoriteStar = ({ task, onToggle, size = 16, className = '' }: TaskFavoriteStarProps) => (
  <button
    onClick={e => { e.stopPropagation(); onToggle(task); }}
    aria-pressed={!!task.isFavorite}
    aria-label={task.isFavorite ? `Remove ${task.name} from favorites` : `Add ${task.name} to favorites`}
    title={task.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    className={`shrink-0 transition-colors ${
      task.isFavorite ? 'text-amber-400 hover:text-amber-500' : 'text-subtle-foreground hover:text-amber-400'
    } ${className}`}
  >
    <Star size={size} className={task.isFavorite ? 'fill-current' : ''} />
  </button>
);
