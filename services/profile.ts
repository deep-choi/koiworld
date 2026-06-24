import { ensureUserDocument, updateUserProfile } from './cloudData';

export const ensureUserProfileNickname = async (
    userId: string,
    displayName?: string | null,
    email?: string | null,
    photoURL?: string | null,
): Promise<string> => {
    return ensureUserDocument(userId, displayName, email, photoURL);
};

export const updateUserNickname = async (userId: string, nickname: string): Promise<void> => {
    await updateUserProfile(userId, nickname);
};
