import React, { useState } from 'react';
import { X, ShoppingCart, Minus, Plus, Trophy } from 'lucide-react';

interface IconProps {
    size?: number;
    className?: string;
}

const CornIcon = ({ size = 24, className = "" }: IconProps) => (
    <div
        className={`bg-current ${className}`}
        style={{
            width: size,
            height: size,
            maskImage: "url('/corn.png')",
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskImage: "url('/corn.png')",
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
        }}
    />
);

const FeedIcon = ({ size = 24, className = "" }: IconProps) => (
    <div
        className={`bg-current ${className}`}
        style={{
            width: size,
            height: size,
            maskImage: "url('/feed.png')",
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskImage: "url('/feed.png')",
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
        }}
    />
);

interface ShopModalProps {
    onClose: () => void;
    zenPoints: number;
    onBuyFood: (quantity: number) => void;
    onBuyFoodLarge: (quantity: number) => void;
    onBuyCorn: (quantity: number) => void;
    onBuyCornLarge: (quantity: number) => void;
    onBuyTrophy: (quantity: number) => void;
    onBuyPond: () => void;
    pondCount: number;
}

const FOOD_PACK_PRICE = 200;
const FOOD_LARGE_PACK_PRICE = 1000;
const CORN_PACK_PRICE = 1000;
const CORN_LARGE_PACK_PRICE = 5000;
const TROPHY_PRICE = 100000;

const ShopItem: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    price: number;
    onBuy: (quantity: number) => void;
    canAfford: (quantity: number) => boolean;
    hasQuantity?: boolean;
    disabled?: boolean;
    disabledReason?: string;
}> = ({ icon, title, description, price, onBuy, canAfford, hasQuantity = false, disabled = false, disabledReason }) => {
    const [quantity, setQuantity] = useState(1);

    const handleQuantityChange = (delta: number) => {
        setQuantity(prev => Math.max(1, Math.min(99, prev + delta)));
    };

    const currentPrice = price * quantity;
    const affordable = canAfford(quantity);

    return (
        <div className="bg-slate-50 p-3 rounded-lg flex flex-col">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 shrink-0 flex items-center justify-center">{icon}</div>
                <div className="flex-grow">
                    <h3 className="text-base font-medium text-slate-900">{title}</h3>
                    <p className="text-sm text-slate-600 mt-1 leading-relaxed">{description}</p>
                </div>
            </div>

            {hasQuantity && (
                <div className="flex items-center justify-between mt-3 bg-white border border-slate-300 rounded-lg p-1">
                    <button
                        onClick={() => handleQuantityChange(-1)}
                        className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-50"
                        disabled={quantity <= 1}
                        aria-label={`${title} 수량 줄이기`}
                    >
                        <Minus size={16} />
                    </button>
                    <span className="text-slate-900 font-medium" aria-live="polite">{quantity}</span>
                    <button
                        onClick={() => handleQuantityChange(1)}
                        className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-50"
                        disabled={quantity >= 99}
                        aria-label={`${title} 수량 늘리기`}
                    >
                        <Plus size={16} />
                    </button>
                </div>
            )}

            <div className="text-base font-semibold text-orange-600 mt-2 text-right">
                {currentPrice.toLocaleString()} ZP
            </div>
            <button
                onClick={() => onBuy(quantity)}
                disabled={!affordable || disabled}
                className="mt-2 w-full h-10 bg-orange-500 text-white font-medium rounded-lg flex items-center justify-center transition-colors disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed enabled:hover:bg-orange-600"
                aria-label={disabled && disabledReason ? `${title}: ${disabledReason}` : `${title} ${quantity}개 구매하기`}
            >
                {disabled && disabledReason ? disabledReason : "구매하기"}
            </button>
        </div>
    );
};


export const ShopModal: React.FC<ShopModalProps> = ({ onClose, zenPoints, onBuyFood, onBuyFoodLarge, onBuyCorn, onBuyCornLarge, onBuyTrophy, onBuyPond, pondCount }) => {

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40 p-4">
            <div
                className="light-modal bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 w-full max-w-sm animate-fade-in-up max-h-[85svh] overflow-y-auto light-scrollbar"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shop-modal-title"
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 id="shop-modal-title" className="text-xl font-medium text-slate-900 flex items-center gap-2">
                        <ShoppingCart size={20} className="text-orange-600" />
                        상점
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors flex items-center justify-center" aria-label="상점 닫기">
                        <X size={18} />
                    </button>
                </div>

                <div className="mb-2 px-1">
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600 font-medium">보유 ZP</span>
                        <span className="text-lg font-semibold text-orange-600">{zenPoints.toLocaleString()} ZP</span>
                    </div>
                </div>

                <div className="space-y-3">
                    <ShopItem
                        icon={<FeedIcon size={32} className="text-orange-500" />}
                        title="기본 사료 (50개)"
                        description="가장 기본적인 물고기 사료입니다."
                        price={FOOD_PACK_PRICE}
                        onBuy={(q) => onBuyFood(q)}
                        canAfford={(q) => zenPoints >= FOOD_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<FeedIcon size={32} className="text-orange-500" />}
                        title="기본 사료 대용량 (250개)"
                        description="대용량으로 더 오랫동안 먹이를 줄 수 있습니다."
                        price={FOOD_LARGE_PACK_PRICE}
                        onBuy={(q) => onBuyFoodLarge(q)}
                        canAfford={(q) => zenPoints >= FOOD_LARGE_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<CornIcon size={32} className="text-orange-600" />}
                        title="프리미엄 옥수수 (50개)"
                        description="일반 먹이보다 3배 효과! 코이가 빠르게 성장합니다."
                        price={CORN_PACK_PRICE}
                        onBuy={(q) => onBuyCorn(q)}
                        canAfford={(q) => zenPoints >= CORN_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<CornIcon size={32} className="text-orange-600" />}
                        title="프리미엄 옥수수 대용량 (250개)"
                        description="옥수수 대량 팩입니다. 대규모 양식에 적합합니다."
                        price={CORN_LARGE_PACK_PRICE}
                        onBuy={(q) => onBuyCornLarge(q)}
                        canAfford={(q) => zenPoints >= CORN_LARGE_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<Plus size={32} strokeWidth={2} className="text-purple-500" />}
                        title="연못 확장권"
                        description="새로운 연못을 추가합니다. (최대 4개)"
                        price={20000}
                        onBuy={() => onBuyPond()}
                        canAfford={() => zenPoints >= 20000}
                        hasQuantity={false}
                        disabled={pondCount >= 4}
                        disabledReason={pondCount >= 4 ? "최대 보유량 도달" : undefined}
                    />
                    <ShopItem
                        icon={<Trophy size={32} strokeWidth={2} className="text-orange-600" />}
                        title="명예 트로피"
                        description="당신의 명예를 증명하는 트로피입니다. 랭킹에 반영됩니다!"
                        price={TROPHY_PRICE}
                        onBuy={(q) => onBuyTrophy(q)}
                        canAfford={(q) => zenPoints >= TROPHY_PRICE * q}
                        hasQuantity={true}
                    />
                </div>

            </div>
        </div>
    );
};
