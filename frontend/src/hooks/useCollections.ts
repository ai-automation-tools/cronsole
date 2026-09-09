import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * Collections — named sets of tasks the user picked by hand.
 *
 * **A collection is a set; a saved view is a query.** A view stores filters and
 * resolves to whatever matches today; a collection stores the tasks. That is why
 * this is its own resource rather than another field on a view: no filter can
 * name "these two Claude routines and these two Windows tasks", because the four
 * share no property to filter on.
 *
 * Membership rides on the task list as `collectionIds` (the same per-viewer join
 * shape as `isFavorite`), so **every mutation here invalidates `['tasks']` too** —
 * the rail counts and the membership ticks are both read from there, and leaving
 * it stale shows a collection whose count disagrees with its own contents.
 */

export interface Collection {
  id: string;
  name: string;
  position: number;
  /** Member task ids, as the server knows them. */
  taskIds: string[];
  /** Server-sent rather than `taskIds.length` — one definition of the number. */
  count: number;
  createdAt: string;
  updatedAt: string;
}

const KEY = ['collections'];

/** Both queries a collection mutation can invalidate, in one place. */
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['tasks'] });
}

export const useCollections = () =>
  useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Collection[]> => {
      const { data } = await api.get('/collections');
      return data;
    }
  });

export const useCreateCollection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; taskIds?: string[] }): Promise<Collection> => {
      const { data } = await api.post('/collections', input);
      return data;
    },
    onSuccess: () => invalidate(qc)
  });
};

export const useUpdateCollection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; position?: number }) => {
      const { id, ...body } = input;
      const { data } = await api.patch(`/collections/${encodeURIComponent(id)}`, body);
      return data as Collection;
    },
    onSuccess: () => invalidate(qc)
  });
};

export const useDeleteCollection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/collections/${encodeURIComponent(id)}`);
      return data as { id: string; deleted: boolean };
    },
    onSuccess: () => invalidate(qc)
  });
};

/**
 * Add and/or remove members in one request.
 *
 * One mutation rather than an add and a remove, mirroring the route: the gesture
 * is "here is what belongs in this collection now", and splitting it would let
 * half a checklist land.
 */
export const useSetCollectionMembers = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; add?: string[]; remove?: string[] }) => {
      const { id, ...body } = input;
      const { data } = await api.post(`/collections/${encodeURIComponent(id)}/members`, body);
      return data as Collection & { ignored: string[] };
    },
    onSuccess: () => invalidate(qc)
  });
};

/**
 * Toggle one task's membership — what a per-task control needs.
 *
 * Built on the same members route rather than a dedicated one, so there is a
 * single server-side definition of "change this collection's contents".
 */
export const useToggleCollectionMember = () => {
  const setMembers = useSetCollectionMembers();
  return {
    ...setMembers,
    toggle: (collectionId: string, taskId: string, isMember: boolean) =>
      setMembers.mutateAsync({
        id: collectionId,
        ...(isMember ? { remove: [taskId] } : { add: [taskId] })
      })
  };
};
