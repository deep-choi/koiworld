import React from 'react';
import { X, Droplets, Sparkles } from 'lucide-react';

interface CleanConfirmModalProps {
    onClose: () => void;
    onConfirm: () => void;
    cost: number;
    zenPoints: number;
}

export const CleanConfirmModal: React.FC<CleanConfirmModalProps> = ({ onClose, onConfirm, cost, zenPoints }) => {
    const canAfford = zenPoints >= cost;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-gray-900 border border-gray-700 p-6 rounded-2xl w-full max-w-sm shadow-2xl animate-fade-in">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="flex flex-col items-center gap-4 text-center">
                    <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mb-2">
                        <Sparkles className="text-blue-400 w-8 h-8" />
                    </div>

                    <h2 className="text-xl font-bold text-white">연못 청소</h2>

                    <div className="space-y-1 text-gray-300">
                        <p>연못을 깨끗하게 청소하시겠습니까?</p>
                        <p className="text-sm text-gray-400">청소하면 수질이 100%로 회복됩니다.</p>
                    </div>

                    <div className="bg-gray-800/50 rounded-lg p-3 w-full border border-gray-700 mt-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-400">보유 ZP</span>
                            <span className="font-bold text-yellow-400">{zenPoints.toLocaleString()} ZP</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-1">
                            <span className="text-gray-400">필요 ZP</span>
                            <span className="font-bold text-red-400">-{cost.toLocaleString()} ZP</span>
                        </div>
                        <div className="h-px bg-gray-700 my-2" />
                        <div className="flex justify-between items-center text-sm font-bold">
                            <span className="text-gray-300">청소 후 잔액</span>
                            <span className={`${canAfford ? 'text-green-400' : 'text-red-500'}`}>
                                {(zenPoints - cost).toLocaleString()} ZP
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full mt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold transition-all"
                        >
                            취소
                        </button>
                        <button
                            onClick={onConfirm}
                            disabled={!canAfford}
                            className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2
                ${canAfford
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                                    : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'}`}
                        >
                            <Droplets size={18} />
                            청소하기
                        </button>
                    </div>
                    {!canAfford && (
                        <p className="text-xs text-red-400 font-bold">젠 포인트가 부족합니다.</p>
                    )}
                </div>
            </div>
        </div>
    );
};
