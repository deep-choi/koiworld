import React, { useState } from 'react';
import { X, ShoppingCart, Minus, Plus, Dna, Pill, Trophy } from 'lucide-react';
import { GENE_COLOR_MAP } from '../utils/genetics';
import { GeneType } from '../types';

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
    onBuyMedicine: (quantity: number) => void;

    onBuyKoi: (color: GeneType) => void;
    onBuyTrophy: (quantity: number) => void;
    onBuyPond: () => void;
    pondCount: number;
    honorPoints: number;
}

const FOOD_PACK_PRICE = 200;
const FOOD_LARGE_PACK_PRICE = 1000;
const CORN_PACK_PRICE = 500;
const CORN_LARGE_PACK_PRICE = 2500;
const MEDICINE_PRICE = 3000;
const RARE_KOI_PRICE = 30000;
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
        <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 flex flex-col">
            <div className="flex items-center gap-3">
                <div className="text-cyan-300">{icon}</div>
                <div className="flex-grow">
                    <h3 className="text-base font-semibold text-white">{title}</h3>
                    <p className="text-xs text-gray-400 mt-1">{description}</p>
                </div>
            </div>

            {hasQuantity && (
                <div className="flex items-center justify-between mt-3 bg-gray-800 rounded-lg p-1">
                    <button
                        onClick={() => handleQuantityChange(-1)}
                        className="p-1 text-gray-400 hover:text-white disabled:opacity-50"
                        disabled={quantity <= 1}
                        aria-label={`${title} 수량 줄이기`}
                    >
                        <Minus size={16} />
                    </button>
                    <span className="text-white font-bold" aria-live="polite">{quantity}</span>
                    <button
                        onClick={() => handleQuantityChange(1)}
                        className="p-1 text-gray-400 hover:text-white disabled:opacity-50"
                        disabled={quantity >= 99}
                        aria-label={`${title} 수량 늘리기`}
                    >
                        <Plus size={16} />
                    </button>
                </div>
            )}

            <div className="text-base font-bold text-yellow-400 mt-2 text-right">
                {currentPrice.toLocaleString()} ZP
            </div>
            <button
                onClick={() => onBuy(quantity)}
                disabled={!affordable || disabled}
                className="mt-2 w-full bg-yellow-600 text-white font-bold py-2 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed enabled:hover:bg-yellow-500"
                aria-label={disabled && disabledReason ? `${title}: ${disabledReason}` : `${title} ${quantity}개 구매하기`}
            >
                {disabled && disabledReason ? disabledReason : "구매하기"}
            </button>
        </div>
    );
};


export const ShopModal: React.FC<ShopModalProps> = ({ onClose, zenPoints, onBuyFood, onBuyFoodLarge, onBuyCorn, onBuyCornLarge, onBuyMedicine, onBuyKoi, onBuyTrophy, onBuyPond, pondCount, honorPoints }) => {

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-40 p-4">
            <div
                className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 w-full max-w-sm animate-fade-in-up max-h-[85svh] overflow-y-auto custom-scrollbar"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shop-modal-title"
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 id="shop-modal-title" className="text-2xl font-bold text-yellow-400 flex items-center">
                        <ShoppingCart className="mr-3" />
                        상점
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="상점 닫기">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex flex-col gap-2 mb-4 bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400 font-bold uppercase">Zen Points</span>
                        <span className="text-lg font-black text-yellow-400">{zenPoints.toLocaleString()} ZP</span>
                    </div>
                    <div className="h-[1px] bg-gray-700/50 w-full" />
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400 font-bold uppercase">My Trophies</span>
                        <div className="flex items-center gap-1.5">
                            <Trophy size={16} className="text-yellow-400" />
                            <span className="text-lg font-black text-yellow-500">{honorPoints.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <ShopItem
                        icon={<FeedIcon size={40} className="text-yellow-100" />}
                        title="기본 사료 (50개)"
                        description="가장 기본적인 물고기 사료입니다."
                        price={FOOD_PACK_PRICE}
                        onBuy={(q) => onBuyFood(q)}
                        canAfford={(q) => zenPoints >= FOOD_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<FeedIcon size={40} className="text-yellow-100" />}
                        title="기본 사료 대용량 (250개)"
                        description="대용량으로 더 오랫동안 먹이를 줄 수 있습니다."
                        price={FOOD_LARGE_PACK_PRICE}
                        onBuy={(q) => onBuyFoodLarge(q)}
                        canAfford={(q) => zenPoints >= FOOD_LARGE_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<CornIcon size={40} className="text-yellow-300" />}
                        title="프리미엄 옥수수 (20개)"
                        description="일반 먹이보다 2배 효과! 코이가 빠르게 성장합니다."
                        price={CORN_PACK_PRICE}
                        onBuy={(q) => onBuyCorn(q)}
                        canAfford={(q) => zenPoints >= CORN_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<CornIcon size={40} className="text-yellow-300" />}
                        title="프리미엄 옥수수 대용량 (100개)"
                        description="옥수수 대량 팩입니다. 대규모 양식에 적합합니다."
                        price={CORN_LARGE_PACK_PRICE}
                        onBuy={(q) => onBuyCornLarge(q)}
                        canAfford={(q) => zenPoints >= CORN_LARGE_PACK_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<Pill size={40} className="text-green-400" />}
                        title="치료제"
                        description="병든 코이를 모두 치료합니다."
                        price={MEDICINE_PRICE}
                        onBuy={(q) => onBuyMedicine(q)}
                        canAfford={(q) => zenPoints >= MEDICINE_PRICE * q}
                        hasQuantity={true}
                    />
                    <ShopItem
                        icon={<div className="text-purple-400 font-bold border-2 border-purple-400 rounded p-1 w-10 h-10 flex items-center justify-center">+</div>}
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
                        icon={<Trophy size={40} className="text-yellow-400" />}
                        title="명예 트로피"
                        description="당신의 명예를 증명하는 트로피입니다. 랭킹에 반영됩니다!"
                        price={TROPHY_PRICE}
                        onBuy={(q) => onBuyTrophy(q)}
                        canAfford={(q) => zenPoints >= TROPHY_PRICE * q}
                        hasQuantity={true}
                    />
                </div>

                <div className="mt-6 border-t border-gray-700 pt-4">
                    <h3 className="text-xl font-bold text-pink-400 mb-3 flex items-center">
                        <Dna className="mr-2" size={24} />
                        특별한 코이
                    </h3>
                    <div className="space-y-3">
                        {[
                            { color: GeneType.CREAM, name: "기본 크림 코이", price: 500, desc: "가장 기본적인 코이입니다." },
                        ].map((item) => (
                            <div key={item.color} className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 flex flex-col">
                                <div className="flex items-center gap-3">
                                    <div
                                        className="w-10 h-10 rounded-full border-2 border-gray-600 shadow-md transform hover:scale-110 transition-transform duration-300"
                                        style={{ backgroundColor: GENE_COLOR_MAP[item.color] as string }}
                                    ></div>
                                    <div className="flex-grow">
                                        <h3 className="text-base font-semibold text-white">{item.name}</h3>
                                        <p className="text-xs text-gray-400 mt-1">{item.desc}</p>
                                    </div>
                                </div>
                                <div className="text-base font-bold text-yellow-400 mt-2 text-right">
                                    {item.price.toLocaleString()} ZP
                                </div>
                                <button
                                    onClick={() => onBuyKoi(item.color)}
                                    disabled={zenPoints < item.price}
                                    className={`mt-2 w-full text-white font-bold py-2 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed ${item.price === 500 ? 'bg-gray-600 hover:bg-gray-500' : 'bg-pink-600 hover:bg-pink-500'
                                        }`}
                                    aria-label={`${item.name} 입양하기`}
                                >
                                    입양하기
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
