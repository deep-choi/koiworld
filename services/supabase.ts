import {
    AuthChangeEvent,
    RealtimeChannel,
    Session,
    User,
    createClient,
} from '@supabase/supabase-js';
import { Koi, MarketplaceListing, SavedGameState } from '../types';

type ListingStatus = MarketplaceListing['status'];

interface ProfileRow {
    id: string;
    nickname: string;
    active_device_id: string | null;
    ap_balance: number;
    new_game_reset_day: string | null;
    new_game_reset_count: number;
    created_at: string;
    last_login_at: string;
}

interface GameStateRow {
    user_id: string;
    state_json: SavedGameState;
    honor_points: number;
    achievement_points: number;
    updated_at: string;
}

interface ListingRow {
    id: string;
    seller_id: string;
    seller_nickname: string;
    koi_id: string;
    koi_json: Koi;
    start_price: number;
    buy_now_price: number;
    current_bid: number;
    current_bidder_id: string | null;
    current_bidder_nickname: string | null;
    bid_count: number;
    status: ListingStatus;
    created_at: string;
    expires_at: string;
}

interface RankingRow {
    user_id: string;
    nickname: string;
    honor_points: number;
    achievement_points: number;
    ap_balance: number;
}

export interface SupabaseUserSnapshot {
    userId: string;
    nickname: string | null;
    ap: number;
    activeDeviceId: string | null;
    gameState: SavedGameState | null;
    honorPoints: number;
    achievementPoints: number;
}

export interface PendingKoiClaim {
    claim_id: string;
    listing_id: string | null;
    koi_json: Koi;
    created_at: string;
}

export interface ProfileSnapshot {
    nickname: string | null;
    activeDeviceId: string | null;
    ap: number;
    lastLoginAt: string | null;
}

const fallbackUrl = 'https://placeholder.supabase.co';
const fallbackAnonKey = 'placeholder-anon-key';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? fallbackUrl;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? fallbackAnonKey;

export const isSupabaseConfigured =
    Boolean(import.meta.env.VITE_SUPABASE_URL) &&
    Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

if (!isSupabaseConfigured && import.meta.env.DEV) {
    console.warn(
        '[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. ' +
        'The scaffold is present, but network calls will fail until the env vars are set.'
    );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
    },
    realtime: {
        params: {
            eventsPerSecond: 10,
        },
    },
});

const mapListingRow = (row: ListingRow): MarketplaceListing => ({
    id: row.id,
    sellerId: row.seller_id,
    sellerNickname: row.seller_nickname,
    koiData: row.koi_json,
    startPrice: row.start_price,
    buyNowPrice: row.buy_now_price,
    currentBid: row.current_bid,
    currentBidderId: row.current_bidder_id,
    currentBidderNickname: row.current_bidder_nickname,
    bidCount: row.bid_count,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    status: row.status,
});

const ensureData = <T,>(data: T | null, error: { message: string } | null | undefined): T => {
    if (error) {
        throw new Error(error.message);
    }
    if (data === null) {
        throw new Error('Expected data but received null.');
    }
    return data;
};

const preflightOAuthUrl = async (url: string): Promise<void> => {
    const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
            Accept: 'application/json',
        },
    });

    if (response.type === 'opaqueredirect') {
        return;
    }

    if (response.ok || (response.status >= 300 && response.status < 400)) {
        return;
    }

    let message = 'OAuth provider validation failed.';

    try {
        const payload = await response.json() as { msg?: string; message?: string };
        message = payload.msg ?? payload.message ?? message;
    } catch {
        // Ignore JSON parse failures and fall back to a generic message.
    }

    throw new Error(message);
};

export const signInWithGoogle = async (): Promise<void> => {
    const redirectUrl = new URL(window.location.href);
    redirectUrl.search = '';
    redirectUrl.hash = '';

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectUrl.toString(),
            skipBrowserRedirect: true,
        },
    });

    if (error) {
        throw error;
    }

    if (!data?.url) {
        throw new Error('Google OAuth URL could not be created.');
    }

    await preflightOAuthUrl(data.url);
    window.location.assign(data.url);
};

export const signOut = async (): Promise<void> => {
    const { error } = await supabase.auth.signOut();
    if (error) {
        throw error;
    }
};

export const getCurrentSession = async (): Promise<Session | null> => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
        throw error;
    }
    return data.session;
};

export const getCurrentUser = async (): Promise<User | null> => {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
        throw error;
    }
    return data.user;
};

export const subscribeToAuthChanges = (
    callback: (event: AuthChangeEvent, session: Session | null) => void
) => {
    const {
        data: { subscription },
    } = supabase.auth.onAuthStateChange(callback);

    return () => subscription.unsubscribe();
};

export const upsertProfileContext = async (input: {
    nickname?: string | null;
    activeDeviceId?: string | null;
    touchLastLogin?: boolean;
}) => {
    const { data, error } = await supabase.rpc('upsert_profile_context', {
        p_nickname: input.nickname ?? null,
        p_active_device_id: input.activeDeviceId ?? null,
        p_touch_last_login: input.touchLastLogin ?? true,
    });

    return ensureData(data, error) as ProfileRow;
};

export const fetchMyUserSnapshot = async (): Promise<SupabaseUserSnapshot | null> => {
    const user = await getCurrentUser();
    if (!user) {
        return null;
    }

    const [{ data: profile, error: profileError }, { data: state, error: stateError }] = await Promise.all([
        supabase.from('profiles').select('*').single(),
        supabase.from('game_states').select('*').single(),
    ]);

    if (profileError) {
        throw profileError;
    }

    if (stateError && stateError.code !== 'PGRST116') {
        throw stateError;
    }

    const typedProfile = ensureData(profile, null) as ProfileRow;
    const typedState = (state ?? null) as GameStateRow | null;

    return {
        userId: user.id,
        nickname: typedProfile.nickname ?? null,
        ap: typedProfile.ap_balance ?? 0,
        activeDeviceId: typedProfile.active_device_id ?? null,
        gameState: typedState?.state_json ?? null,
        honorPoints: typedState?.honor_points ?? 0,
        achievementPoints: typedState?.achievement_points ?? 0,
    };
};

export const fetchMyProfile = async (): Promise<ProfileSnapshot | null> => {
    const user = await getCurrentUser();
    if (!user) {
        return null;
    }

    const { data, error } = await supabase.from('profiles').select('*').single();
    if (error) {
        throw error;
    }

    const profile = ensureData(data, null) as ProfileRow;
    return {
        nickname: profile.nickname ?? null,
        activeDeviceId: profile.active_device_id ?? null,
        ap: profile.ap_balance ?? 0,
        lastLoginAt: profile.last_login_at ?? null,
    };
};

export const saveGameState = async (
    state: SavedGameState,
    achievementPoints = 0
): Promise<GameStateRow> => {
    const { data, error } = await supabase.rpc('sync_game_state', {
        p_state: state,
        p_honor_points: state.honorPoints ?? 0,
        p_achievement_points: achievementPoints,
    });

    return ensureData(data, error) as GameStateRow;
};

export const resetGameData = async (
    initialState: SavedGameState,
    apBalance = 400
) => {
    const { data, error } = await supabase.rpc('reset_game_data', {
        p_initial_state: initialState,
        p_ap_balance: apBalance,
    });

    return ensureData(data, error);
};

export const setClientApBalance = async (apBalance: number): Promise<ProfileRow> => {
    const { data, error } = await supabase.rpc('set_client_ap_balance', {
        p_ap_balance: apBalance,
    });

    return ensureData(data, error) as ProfileRow;
};

export const fetchActiveListings = async (limitCount = 50): Promise<MarketplaceListing[]> => {
    const { data, error } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(limitCount);

    return ensureData(data, error).map((row) => mapListingRow(row as ListingRow));
};

export const fetchMyActiveListings = async (userId: string): Promise<MarketplaceListing[]> => {
    const { data, error } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('seller_id', userId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

    return ensureData(data, error).map((row) => mapListingRow(row as ListingRow));
};

export const fetchListingById = async (listingId: string): Promise<MarketplaceListing | null> => {
    const { data, error } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('id', listingId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data ? mapListingRow(data as ListingRow) : null;
};

export const createListing = async (input: {
    koi: Koi;
    buyNowPrice: number;
    startPrice?: number;
    listingFee?: number;
}) => {
    const { data, error } = await supabase.rpc('create_listing', {
        p_koi: input.koi,
        p_buy_now_price: input.buyNowPrice,
        p_start_price: input.startPrice ?? input.buyNowPrice,
        p_listing_fee: input.listingFee ?? 100,
    });

    return mapListingRow(ensureData(data, error) as ListingRow);
};

export const placeBid = async (listingId: string, amount: number) => {
    const { data, error } = await supabase.rpc('place_bid', {
        p_listing_id: listingId,
        p_amount: amount,
    });

    return mapListingRow(ensureData(data, error) as ListingRow);
};

export const buyNowListing = async (listingId: string) => {
    const { data, error } = await supabase.rpc('buy_now', {
        p_listing_id: listingId,
    });

    return mapListingRow(ensureData(data, error) as ListingRow);
};

export const cancelListing = async (listingId: string) => {
    const { data, error } = await supabase.rpc('cancel_listing', {
        p_listing_id: listingId,
    });

    return mapListingRow(ensureData(data, error) as ListingRow);
};

export const claimAdReward = async (verificationToken: string, adType: '15s' | '30s') => {
    const { data, error } = await supabase.rpc('claim_ad_reward', {
        p_verification_token: verificationToken,
        p_ad_type: adType,
    });

    return ensureData(data, error);
};

export const claimPendingKois = async (): Promise<PendingKoiClaim[]> => {
    const { data, error } = await supabase.rpc('claim_pending_kois');
    return ensureData(data, error) as PendingKoiClaim[];
};

export const fetchRankings = async (
    kind: 'honorPoints' | 'achievementPoints' = 'honorPoints',
    limitCount = 20
): Promise<RankingRow[]> => {
    const { data, error } = await supabase.rpc('get_rankings', {
        p_kind: kind,
        p_limit: limitCount,
    });

    return ensureData(data, error) as RankingRow[];
};

const subscribeToTableRow = (
    channelName: string,
    table: 'profiles' | 'game_states',
    filter: string,
    onRefresh: () => Promise<void>
): RealtimeChannel => {
    const channel = supabase.channel(channelName);

    channel.on(
        'postgres_changes',
        {
            event: '*',
            schema: 'public',
            table,
            filter,
        },
        () => {
            void onRefresh();
        }
    );

    channel.subscribe();
    return channel;
};

const subscribeToListingChanges = (
    channelName: string,
    filter: string | undefined,
    onRefresh: () => Promise<void>
): RealtimeChannel => {
    const channel = supabase.channel(channelName);

    channel.on(
        'postgres_changes',
        {
            event: '*',
            schema: 'public',
            table: 'marketplace_listings',
            ...(filter ? { filter } : {}),
        },
        () => {
            void onRefresh();
        }
    );

    channel.subscribe();
    return channel;
};

export const subscribeToActiveListings = async (
    onUpdate: (listings: MarketplaceListing[]) => void
): Promise<() => void> => {
    const refresh = async () => {
        const listings = await fetchActiveListings();
        onUpdate(listings);
    };

    await refresh();
    const channel = subscribeToListingChanges('marketplace-active-listings', undefined, refresh);
    return () => {
        void supabase.removeChannel(channel);
    };
};

export const subscribeToMyProfile = async (
    userId: string,
    onUpdate: (profile: ProfileSnapshot | null) => void
): Promise<() => void> => {
    const refresh = async () => {
        const profile = await fetchMyProfile();
        onUpdate(profile);
    };

    await refresh();
    const channel = subscribeToTableRow(
        `profile-${userId}`,
        'profiles',
        `id=eq.${userId}`,
        refresh
    );

    return () => {
        void supabase.removeChannel(channel);
    };
};

export const subscribeToMyGameState = async (
    userId: string,
    onUpdate: (state: SavedGameState | null) => void
): Promise<() => void> => {
    const refresh = async () => {
        const snapshot = await fetchMyUserSnapshot();
        onUpdate(snapshot?.gameState ?? null);
    };

    await refresh();
    const channel = subscribeToTableRow(
        `game-state-${userId}`,
        'game_states',
        `user_id=eq.${userId}`,
        refresh
    );

    return () => {
        void supabase.removeChannel(channel);
    };
};

export const subscribeToPendingKoiClaims = async (
    userId: string,
    onUpdate: (claims: PendingKoiClaim[]) => void
): Promise<() => void> => {
    const refresh = async () => {
        const claims = await claimPendingKois();
        onUpdate(claims);
    };

    await refresh();
    const channel = subscribeToTableRow(
        `pending-koi-claims-${userId}`,
        'pending_koi_claims',
        `user_id=eq.${userId}`,
        refresh
    );

    return () => {
        void supabase.removeChannel(channel);
    };
};

export const subscribeToListing = async (
    listingId: string,
    onUpdate: (listing: MarketplaceListing | null) => void
): Promise<() => void> => {
    const refresh = async () => {
        const listing = await fetchListingById(listingId);
        onUpdate(listing);
    };

    await refresh();
    const channel = subscribeToListingChanges(
        `marketplace-listing-${listingId}`,
        `id=eq.${listingId}`,
        refresh
    );

    return () => {
        void supabase.removeChannel(channel);
    };
};
