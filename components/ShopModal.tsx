import React, { useState } from 'react';
import { ABSOLUTE_MAX_POND_COUNT } from '../functions/src/saveValidation';
import { X, ShoppingCart, Minus, Plus, Trophy, Smartphone, Ban } from 'lucide-react';
import { CornIcon, FeedIcon } from './FoodIcons';
import { MODAL_CLOSE } from './menuStyles';
import { PLAY_PRODUCT_IDS, type PlayProductId } from '../config/monetization';

/** Google Play 상품 관련 상태. 앱(Android)과 웹이 같은 모양을 받고, isNativeStore로 구분합니다. */
export interface ShopMonetizationProps {
    isNativeStore: boolean;
    prices: Partial<Record<PlayProductId, string>>;
    busyProductId: PlayProductId | null;
    paidPondSlots: number;
    pondCount: number;
    adFree: boolean;
    onPurchase: (productId: PlayProductId) => void;
}

interface ShopModalProps {
    onClose: () => void;
    zenPoints: number;
    onBuyFood: (quantity: number) => void;
    onBuyFoodLarge: (quantity: number) => void;
    onBuyCorn: (quantity: number) => void;
    onBuyCornLarge: (quantity: number) => void;
    onBuyTrophy: (quantity: number) => void;
    monetization: ShopMonetizationProps;
}

const FOOD_PACK_PRICE = 200;
const FOOD_LARGE_PACK_PRICE = 800; // 20% bulk discount
const CORN_PACK_PRICE = 1000;
const CORN_LARGE_PACK_PRICE = 4000; // 20% bulk discount
const TROPHY_PRICE = 100000;

// 구매 버튼: 설명 아래 전체 폭입니다(상점 창이 좁아 넓은 화면에서도 같은 모양).
// 젠 포인트 상품과 Google Play 상품 모두 같은 브랜드 오렌지를 씁니다.
const BUY_BUTTON = 'w-full h-11 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors bg-orange-500 text-white enabled:hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed';
// 수량 선택: 구매 버튼과 같은 전체 폭. −는 왼쪽 끝, 숫자는 가운데, +는 오른쪽 끝입니다.
const STEP_BUTTON = 'w-11 h-full shrink-0 flex items-center justify-center text-slate-500 enabled:hover:text-slate-900 disabled:opacity-40';

/**
 * 상점의 한 줄. 상자 안에 상자를 넣지 않고, 목록의 구분선(divide-y)으로만 나눕니다.
 * 위쪽: 아이콘 · 이름 · 가격 · 설명 / 아래쪽: 전체 폭 수량 선택과 전체 폭 구매 버튼
 */
const ShopRow: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: React.ReactNode;
    price?: React.ReactNode;
    children?: React.ReactNode;
}> = ({ icon, title, description, price, children }) => (
    <li className="py-4">
        <div className="flex items-start gap-3">
            <div className="w-9 h-9 shrink-0 flex items-center justify-center" aria-hidden="true">{icon}</div>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                    <h4 className="text-base font-medium text-slate-900">{title}</h4>
                    {price && <span className="shrink-0 text-sm font-semibold text-orange-600">{price}</span>}
                </div>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed break-keep">{description}</p>
            </div>
        </div>
        {children && <div className="mt-3 flex flex-col gap-2">{children}</div>}
    </li>
);

const ShopSection: React.FC<{ title: string; note?: React.ReactNode; children: React.ReactNode }> = ({ title, note, children }) => (
    <section className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500">{title}</h3>
        {note && <p className="mt-1 text-xs leading-relaxed text-slate-500 break-keep">{note}</p>}
        <ul className="divide-y divide-slate-200">{children}</ul>
    </section>
);

/** 젠 포인트 상품: 수량을 2개 이상 고르면 구매 버튼에 합계를 함께 보여 줍니다. */
const ZenShopItem: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    price: number;
    zenPoints: number;
    onBuy: (quantity: number) => void;
    hasQuantity?: boolean;
}> = ({ icon, title, description, price, zenPoints, onBuy, hasQuantity = false }) => {
    const [quantity, setQuantity] = useState(1);
    const total = price * quantity;
    const affordable = zenPoints >= total;
    const changeQuantity = (delta: number) => setQuantity(prev => Math.max(1, Math.min(99, prev + delta)));

    return (
        <ShopRow icon={icon} title={title} description={description} price={`${price.toLocaleString()} ZP`}>
            {hasQuantity && (
                <div className="flex h-11 w-full items-center rounded-lg border border-slate-300">
                    <button
                        onClick={() => changeQuantity(-1)}
                        className={STEP_BUTTON}
                        disabled={quantity <= 1}
                        aria-label={`${title} 수량 줄이기`}
                    >
                        <Minus size={16} />
                    </button>
                    <span className="flex-1 text-center text-slate-900 font-medium tabular-nums" aria-live="polite">{quantity}</span>
                    <button
                        onClick={() => changeQuantity(1)}
                        className={STEP_BUTTON}
                        disabled={quantity >= 99}
                        aria-label={`${title} 수량 늘리기`}
                    >
                        <Plus size={16} />
                    </button>
                </div>
            )}
            <button
                onClick={() => onBuy(quantity)}
                disabled={!affordable}
                className={BUY_BUTTON}
                aria-label={`${title} ${quantity}개 구매하기, 합계 ${total.toLocaleString()} ZP`}
            >
                {affordable ? '구매하기' : 'ZP 부족'}
                {quantity > 1 && <span className="font-normal opacity-90">· 합계 {total.toLocaleString()} ZP</span>}
            </button>
        </ShopRow>
    );
};

/** Google Play 상품의 버튼 자리. 웹에서는 버튼 대신 앱 구매 안내를 보여 줍니다. */
const PlayPurchaseAction: React.FC<{
    title: string;
    productId: PlayProductId;
    monetization: ShopMonetizationProps;
    ownedReason?: string;
}> = ({ title, productId, monetization, ownedReason }) => {
    if (!monetization.isNativeStore) {
        return (
            <p className="flex items-center gap-2 text-sm text-slate-600">
                <Smartphone size={16} className="shrink-0 text-orange-600" aria-hidden="true" />
                {ownedReason ?? '앱에서 구매할 수 있어요'}
            </p>
        );
    }
    const isBusy = monetization.busyProductId === productId;
    return (
        <button
            onClick={() => monetization.onPurchase(productId)}
            disabled={!!ownedReason || monetization.busyProductId !== null}
            className={BUY_BUTTON}
            aria-label={ownedReason ? `${title}: ${ownedReason}` : `${title} Google Play로 구매하기`}
        >
            {ownedReason ?? (isBusy ? '결제 확인 중…' : '구매하기')}
        </button>
    );
};

export const ShopModal: React.FC<ShopModalProps> = ({
    onClose, zenPoints, onBuyFood, onBuyFoodLarge, onBuyCorn, onBuyCornLarge, onBuyTrophy, monetization,
}) => {
    const pondSlotsFull = monetization.pondCount >= ABSOLUTE_MAX_POND_COUNT;
    const playPrice = (productId: PlayProductId) => monetization.isNativeStore ? (monetization.prices[productId] ?? '') : '';

    return (
        // Android 배너가 화면 맨 아래를 덮으므로 그 높이만큼 아래 여백을 더해 상점이 가려지지 않게 합니다.
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40 p-4 pb-[calc(1rem+var(--ad-banner-height,0px))]">
            <div
                className="light-modal bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 w-full max-w-sm sm:max-w-md animate-fade-in-up max-h-[min(88svh,calc(100svh-2rem-var(--ad-banner-height,0px)))] overflow-y-auto light-scrollbar"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shop-modal-title"
            >
                <div className="flex justify-between items-center mb-3">
                    <h2 id="shop-modal-title" className="text-xl font-medium text-slate-900 flex items-center gap-2">
                        <ShoppingCart size={20} className="text-orange-600" />
                        상점
                    </h2>
                    <button onClick={onClose} className={MODAL_CLOSE} aria-label="상점 닫기">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex justify-between items-center pb-4 mb-4 border-b border-slate-200">
                    <span className="text-sm text-slate-600 font-medium">보유 ZP</span>
                    <span className="text-lg font-semibold text-orange-600">{zenPoints.toLocaleString()} ZP</span>
                </div>

                <div className="space-y-4">
                    <ShopSection title="먹이">
                        <ZenShopItem
                            icon={<FeedIcon size={30} className="text-orange-500" />}
                            title="기본 사료 (50개)"
                            description="가장 기본적인 물고기 사료입니다."
                            price={FOOD_PACK_PRICE}
                            zenPoints={zenPoints}
                            onBuy={onBuyFood}
                            hasQuantity
                        />
                        <ZenShopItem
                            icon={<FeedIcon size={30} className="text-orange-500" />}
                            title="기본 사료 대용량 (250개)"
                            description="대용량으로 더 오랫동안 먹이를 줄 수 있습니다."
                            price={FOOD_LARGE_PACK_PRICE}
                            zenPoints={zenPoints}
                            onBuy={onBuyFoodLarge}
                            hasQuantity
                        />
                        <ZenShopItem
                            icon={<CornIcon size={30} className="text-orange-600" />}
                            title="프리미엄 옥수수 (50개)"
                            description="일반 먹이보다 2배 효과! 코이가 빠르게 성장합니다."
                            price={CORN_PACK_PRICE}
                            zenPoints={zenPoints}
                            onBuy={onBuyCorn}
                            hasQuantity
                        />
                        <ZenShopItem
                            icon={<CornIcon size={30} className="text-orange-600" />}
                            title="프리미엄 옥수수 대용량 (250개)"
                            description="옥수수 대량 팩입니다. 대규모 양식에 적합합니다."
                            price={CORN_LARGE_PACK_PRICE}
                            zenPoints={zenPoints}
                            onBuy={onBuyCornLarge}
                            hasQuantity
                        />
                    </ShopSection>

                    <ShopSection title="연못">
                        <ShopRow
                            icon={<Plus size={28} strokeWidth={2} className="text-purple-500" />}
                            title="연못 확장권"
                            description={`연못을 하나 더 받아요. 계정에 저장되어 재설치하거나 웹에서 로그인해도 유지돼요. (연못 ${monetization.pondCount}/${ABSOLUTE_MAX_POND_COUNT})`}
                            price={playPrice(PLAY_PRODUCT_IDS.pondSlot)}
                        >
                            <PlayPurchaseAction
                                title="연못 확장권"
                                productId={PLAY_PRODUCT_IDS.pondSlot}
                                monetization={monetization}
                                ownedReason={pondSlotsFull ? '최대 보유량 도달' : undefined}
                            />
                        </ShopRow>
                    </ShopSection>

                    <ShopSection title="광고 제거">
                        <ShopRow
                            icon={<Ban size={26} strokeWidth={2} className="text-orange-600" />}
                            title="광고 제거"
                            description="한 번 사면 앱 하단 배너와 동영상 광고가 모두 사라져요."
                            price={playPrice(PLAY_PRODUCT_IDS.removeAds)}
                        >
                            <PlayPurchaseAction
                                title="광고 제거"
                                productId={PLAY_PRODUCT_IDS.removeAds}
                                monetization={monetization}
                                ownedReason={monetization.adFree ? '적용됨' : undefined}
                            />
                        </ShopRow>
                    </ShopSection>

                    <ShopSection title="명예">
                        <ZenShopItem
                            icon={<Trophy size={28} strokeWidth={2} className="text-orange-600" />}
                            title="명예 트로피"
                            description="당신의 명예를 증명하는 트로피입니다. 랭킹에 반영됩니다!"
                            price={TROPHY_PRICE}
                            zenPoints={zenPoints}
                            onBuy={onBuyTrophy}
                            hasQuantity
                        />
                    </ShopSection>

                    {!monetization.isNativeStore && (
                        <p className="border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500 break-keep">
                            연못 확장권과 광고 제거는 Android 앱에서 구매할 수 있어요. 앱에서 산 혜택은 같은 계정으로 로그인하면 웹에서도 적용돼요.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};
