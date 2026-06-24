import { SavedGameState } from '../types';

export const isValidSavedGameState = (value: unknown): value is SavedGameState => {
    if (!value || typeof value !== 'object') return false;

    const state = value as Partial<SavedGameState>;
    if (!state.ponds || typeof state.ponds !== 'object') return false;
    if (typeof state.activePondId !== 'string') return false;
    if (!state.ponds[state.activePondId]) return false;
    if (typeof state.zenPoints !== 'number') return false;
    if (typeof state.foodCount !== 'number') return false;
    if (typeof state.koiNameCounter !== 'number') return false;

    return true;
};
