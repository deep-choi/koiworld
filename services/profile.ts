import { fetchMyProfile, getCurrentUser, upsertProfileContext } from './supabase';

const buildDefaultNickname = (userId: string, displayName?: string | null, email?: string | null) => {
    const name = displayName?.trim();
    if (name) return name;

    const emailPrefix = email?.split('@')?.[0]?.trim();
    if (emailPrefix) return emailPrefix;

    return `Koi_${userId.slice(0, 6)}`;
};

export const ensureUserProfileNickname = async (
    userId: string,
    displayName?: string | null,
    email?: string | null,
): Promise<string> => {
    const fallbackNickname = buildDefaultNickname(userId, displayName, email);
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
        throw new Error('Authenticated Supabase user does not match the requested profile.');
    }

    const existingProfile = await fetchMyProfile();
    const existingNickname = existingProfile?.nickname?.trim() ?? '';

    if (existingNickname) {
        await upsertProfileContext({ touchLastLogin: true });
        return existingNickname;
    }

    const profile = await upsertProfileContext({
        nickname: fallbackNickname,
        touchLastLogin: true,
    });
    return profile.nickname;
};

export const updateUserNickname = async (userId: string, nickname: string): Promise<void> => {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
        throw new Error('Authenticated Supabase user does not match the requested profile.');
    }

    const trimmed = nickname.trim();
    await upsertProfileContext({
        nickname: trimmed,
        touchLastLogin: false,
    });
};
