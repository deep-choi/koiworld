import React, { useEffect, useMemo, useState } from 'react';
import { X, DollarSign } from 'lucide-react';
import { Koi, MarketplaceListing } from '../types';
import { buyNowListing, cancelListing, listenToListing } from '../services/marketplace';
import { calculateSpotPhenotype, GENE_COLOR_MAP } from '../utils/genetics';
import { SingleKoiCanvas } from './SingleKoiCanvas';

// Reusing generic modal styles or similar
interface ListingDetailModalProps {
    listing: MarketplaceListing;
    onClose: () => void;
    currentUserId?: string;
    userNickname: string;
    userAP: number;
    onBuySuccess: (koi?: Koi) => void;
    onCancelSuccess: (koi: Koi) => void;
}

export const ListingDetailModal: React.FC<ListingDetailModalProps> = ({
    listing,
    onClose,
    currentUserId,
    userNickname,
    userAP,
    onBuySuccess,
    onCancelSuccess
}) => {
    const [liveListing, setLiveListing] = useState<MarketplaceListing>(listing);
    const isOwner = currentUserId === liveListing.sellerId;
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const spotPhenotype = useMemo(() => calculateSpotPhenotype(liveListing.koiData.genetics.spotPhenotypeGenes, liveListing.koiData), [liveListing.koiData]);

    useEffect(() => {
        setLiveListing(listing);
        setError(null);
        setNotice(null);
        setIsProcessing(false);
    }, [listing.id]);

    useEffect(() => {
        const unsubscribe = listenToListing(listing.id, (next) => {
            if (!next) return;
            setLiveListing(next);
        });
        return () => unsubscribe();
    }, [listing.id]);

    const TRANSACTION_FEE_RATE = 0.05;

    const requiredBuyNowAp = useMemo(() => {
        if (typeof liveListing.buyNowPrice !== 'number' || liveListing.buyNowPrice <= 0) return Infinity;
        return Math.ceil(liveListing.buyNowPrice * (1 + TRANSACTION_FEE_RATE));
    }, [liveListing.buyNowPrice]);

    const handleBuyNow = async () => {
        if (!currentUserId) return;
        if (typeof liveListing.buyNowPrice !== 'number' || liveListing.buyNowPrice <= 0) return;

        setIsProcessing(true);
        setError(null);
        setNotice(null);
        try {
            const result: any = await buyNowListing(liveListing.id);
            onBuySuccess(result?.koiData as Koi | undefined);
            onClose();
        } catch (e) {
            console.error(e);
            setError("구매 처리에 실패했습니다. (이미 판매되었거나 오류 발생)");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCancel = async () => {
        if (!isOwner) return;

        setIsProcessing(true);
        setError(null);
        setNotice(null);
        try {
            await cancelListing(liveListing.id);
            onCancelSuccess(liveListing.koiData);
            onClose();
        } catch (e: any) {
            console.error('[Marketplace] Cancellation failed:', e);
            // 즉시 구매 시스템이므로 취소 실패는 보통 이미 팔린 경우임
            const errorMessage = e?.message?.includes('failed-precondition')
                ? "취소할 수 없습니다. 이미 판매되었거나 활성화된 상태가 아닙니다."
                : (e?.message || "취소에 실패했습니다. 서버 오류가 발생했습니다.");
            setError(errorMessage);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 relative shadow-2xl">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white"
                >
                    <X />
                </button>

                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <span className="text-cyan-400">장터 매물 상세</span>
                </h2>

                <div className="flex flex-col items-center mb-6 w-full">
                    {/* 돋보기 메뉴(상세보기)와 동일한 미리보기 스타일 */}
                    <div className="bg-blue-900/30 p-4 rounded-lg border border-gray-700 flex items-center justify-center overflow-hidden w-full mb-4" style={{ height: '200px' }}>
                        <SingleKoiCanvas koi={liveListing.koiData} width={400} height={180} isStatic={true} />
                    </div>

                    <h3 className="text-2xl font-bold text-white text-center">{liveListing.koiData.name}</h3>
                    <p className="text-gray-400 text-sm mt-1 whitespace-nowrap">판매자: {liveListing.sellerNickname}</p>
                </div>

                <div className="bg-gray-800/50 rounded-xl p-4 mb-6 space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-gray-700 whitespace-nowrap gap-4">
                        <span className="text-gray-400">판매 가격</span>
                        <span className="text-xl font-bold text-yellow-400">{liveListing.buyNowPrice?.toLocaleString()} AP</span>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-gray-400 whitespace-nowrap">
                            <span className="font-bold text-gray-500 w-12">[몸]</span>
                            <span>명도: <span className="text-gray-200">{Math.round(liveListing.koiData.genetics.lightness)}</span></span>
                            <span className="text-gray-600">|</span>
                            <span>채도: <span className="text-gray-200">{Math.round(liveListing.koiData.genetics.saturation)}</span></span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400 whitespace-nowrap">
                            <span className="font-bold text-gray-500 w-12">[무늬]</span>
                            <span>점: <span className="text-cyan-300">{liveListing.koiData.genetics.spots.length}개</span></span>
                            <span className="text-gray-600">|</span>
                            <span>채도: <span className="text-gray-200">{(calculateSpotPhenotype(liveListing.koiData.genetics.spotPhenotypeGenes).colorSaturation * 100).toFixed(0)}</span></span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-500 pt-1">
                            <span className="font-bold text-gray-600 w-12">유전자</span>
                            <div className="flex flex-wrap gap-1">
                                {liveListing.koiData.genetics.baseColorGenes.map((gene, idx) => (
                                    <span key={idx} className="flex items-center gap-1 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-700 text-[11px]">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: GENE_COLOR_MAP[gene] }}></span>
                                        {gene}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-gray-700 text-xs text-gray-500 text-center">
                        유전자 기반 정보가 표시됩니다
                    </div>
                </div>

                {notice && (
                    <div className="bg-cyan-900/40 border border-cyan-500/30 text-cyan-200 text-sm p-3 rounded-lg mb-4 text-center">
                        {notice}
                    </div>
                )}

                {error && (
                    <div className="bg-red-900/50 border border-red-500/50 text-red-200 text-sm p-3 rounded-lg mb-4 text-center">
                        {error}
                    </div>
                )}

                <div className="flex gap-3">
                    {isOwner ? (
                        <button
                            onClick={handleCancel}
                            disabled={isProcessing}
                            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                        >
                            {isProcessing ? '처리 중...' : '판매 취소'}
                        </button>
                    ) : (
                        <button
                            onClick={handleBuyNow}
                            disabled={
                                isProcessing ||
                                typeof liveListing.buyNowPrice !== 'number' ||
                                liveListing.buyNowPrice <= 0 ||
                                userAP < requiredBuyNowAp
                            }
                            className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-bold py-3 rounded-xl transition-all shadow-lg shadow-yellow-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isProcessing ? '처리 중...' : (
                                <>
                                    <DollarSign size={20} />
                                    즉시 구매 ({liveListing.buyNowPrice?.toLocaleString() ?? '-'} AP)
                                </>
                            )}
                        </button>
                    )}
                </div>
                {!isOwner && typeof liveListing.buyNowPrice === 'number' && liveListing.buyNowPrice > 0 && userAP < requiredBuyNowAp && (
                    <p className="text-xs text-red-400 text-center mt-2">AP가 부족합니다. ({requiredBuyNowAp.toLocaleString()} AP 필요)</p>
                )}
            </div>
        </div>
    );
};
