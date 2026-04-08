import { Koi, MarketplaceListing, SavedGameState } from '../types';
import {
    buyNowListing as buyNowListingRpc,
    cancelListing as cancelListingRpc,
    createListing as createListingRpc,
    fetchListingById,
    fetchMyActiveListings,
    placeBid as placeBidRpc,
    subscribeToActiveListings as subscribeToActiveListingsRealtime,
    subscribeToListing as subscribeToListingRealtime,
} from './supabase';

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        ),
    ]);
};

export const fetchActiveListings = (onUpdate: (listings: MarketplaceListing[]) => void) => {
    let unsubscribe = () => {};

    void subscribeToActiveListingsRealtime(onUpdate).then((cleanup) => {
        unsubscribe = cleanup;
    }).catch((error) => {
        console.error('[Marketplace] fetchActiveListings error:', error);
    });

    return () => unsubscribe();
};

export const fetchUserActiveListings = (userId: string, onUpdate: (listings: MarketplaceListing[]) => void) => {
    let cancelled = false;
    let unsubscribe = () => {};

    const refresh = async () => {
        const listings = await fetchMyActiveListings(userId);
        if (!cancelled) {
            onUpdate(listings);
        }
    };

    void refresh().catch((error) => {
        console.error('[Marketplace] fetchUserActiveListings error:', error);
    });

    void subscribeToActiveListingsRealtime(() => {
        void refresh().catch((error) => {
            console.error('[Marketplace] fetchUserActiveListings realtime refresh error:', error);
        });
    }).then((cleanup) => {
        unsubscribe = cleanup;
    }).catch((error) => {
        console.error('[Marketplace] fetchUserActiveListings subscribe error:', error);
    });

    return () => {
        cancelled = true;
        unsubscribe();
    };
};

export const listenToListing = (listingId: string, onUpdate: (listing: MarketplaceListing | null) => void) => {
    let unsubscribe = () => {};

    void subscribeToListingRealtime(listingId, onUpdate).then((cleanup) => {
        unsubscribe = cleanup;
    }).catch((error) => {
        console.error('[Marketplace] listenToListing error:', error);
    });

    return () => unsubscribe();
};

export const createListingAtomic = async (
    userId: string,
    sellerNickname: string,
    koi: Koi,
    price: number,
    currentGameState: SavedGameState
): Promise<void> => {
    if (!userId) {
        throw new Error('로그인 정보가 없습니다. 다시 로그인 해주세요.');
    }

    void sellerNickname;
    void currentGameState;

    const koiData = JSON.parse(JSON.stringify(koi));

    await withTimeout(
        createListingRpc({
            koi: koiData,
            buyNowPrice: price,
            startPrice: price,
            listingFee: 100,
        }),
        15000,
        '서버 응답이 느립니다. 장터를 확인해주세요.'
    );
};

export const createListing = async (
    sellerId: string,
    sellerNickname: string,
    koi: Koi,
    startPrice: number,
    buyNowPrice?: number
): Promise<string> => {
    if (!sellerId) {
        throw new Error('로그인 정보가 없습니다. 다시 로그인 해주세요.');
    }

    void sellerNickname;

    const listing = await withTimeout(
        createListingRpc({
            koi: JSON.parse(JSON.stringify(koi)),
            buyNowPrice: buyNowPrice ?? startPrice,
            startPrice,
            listingFee: 100,
        }),
        15000,
        '서버 응답이 늦어지고 있습니다. 잠시 후 장터를 확인해주세요.'
    );

    return listing.id;
};

export const placeBid = async (
    listingId: string,
    bidderId: string,
    bidderNickname: string,
    amount: number
) => {
    void bidderId;
    void bidderNickname;

    await withTimeout(
        placeBidRpc(listingId, amount),
        10000,
        '입찰 요청 시간 초과'
    );
};

export const buyNowListing = async (listingId: string) => {
    try {
        return await withTimeout(
            buyNowListingRpc(listingId),
            15000,
            '구매 요청 시간 초과'
        );
    } catch (error) {
        console.error('[Marketplace] FAILED: buyNowListing:', error);
        throw error;
    }
};

export const cancelListing = async (listingId: string) => {
    try {
        return await withTimeout(
            cancelListingRpc(listingId),
            15000,
            '취소 요청 시간 초과'
        );
    } catch (error) {
        console.error('[Marketplace] FAILED: cancelListing:', error);
        throw error;
    }
};

export const getListingById = async (listingId: string): Promise<MarketplaceListing | null> => {
    return fetchListingById(listingId);
};

export const getBidsForListing = async (_listingId: string): Promise<never[]> => {
    return [];
};
