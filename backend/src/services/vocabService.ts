import { createEntry, deleteEntry, listEntriesForUser, updateEntry } from '../repositories/vocabRepository';

export const getEntriesForUser = (userId: number) => listEntriesForUser(userId);

export const addEntryForUser = (
  userId: number,
  payload: { term: string; definition: string; notes?: string }
) => createEntry(userId, payload.term, payload.definition, payload.notes ?? '');

export const updateEntryForUser = (
  userId: number,
  entryId: number,
  payload: { term: string; definition: string; notes?: string }
) =>
  updateEntry(userId, entryId, {
    term: payload.term,
    definition: payload.definition,
    notes: payload.notes ?? '',
  });

export const removeEntryForUser = (userId: number, entryId: number) => {
  deleteEntry(userId, entryId);
};
