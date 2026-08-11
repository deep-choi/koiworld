import React from 'react';
import { X, Droplets } from 'lucide-react';

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

            <div className="light-modal relative bg-white border border-slate-200 p-5 rounded-2xl w-full max-w-sm shadow-2xl animate-fade-in" onClick={event => event.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors flex items-center justify-center"
                    aria-label="연못 청소 확인창 닫기"
                >
                    <X size={18} />
                </button>

                <div className="flex flex-col gap-4">
                    <h2 className="pr-10 text-xl font-medium text-slate-900">연못 청소</h2>

                    <div className="space-y-1 text-sm text-slate-500">
                        <p>연못을 깨끗하게 청소하시겠습니까?</p>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 w-full">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-sm text-slate-400">보유 ZP</span>
                            <span className="text-sm font-medium text-slate-700">{zenPoints.toLocaleString()} ZP</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-2">
                            <span className="text-sm text-slate-400">필요 ZP</span>
                            <span className="text-sm font-medium text-red-400">-{cost.toLocaleString()} ZP</span>
                        </div>
                        <div className="border-t border-slate-200 my-3" />
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-sm font-medium text-slate-600">청소 후 잔액</span>
                            <span className={`text-sm font-medium ${canAfford ? 'text-slate-700' : 'text-red-500'}`}>
                                {(zenPoints - cost).toLocaleString()} ZP
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-red-300 font-medium transition-all"
                            aria-label="연못 청소 취소"
                        >
                            취소
                        </button>
                        <button
                            onClick={onConfirm}
                            disabled={!canAfford}
                            className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2
                ${canAfford
                                    ? 'bg-orange-500 hover:bg-orange-400 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                            aria-label={`연못 청소하기, ${cost.toLocaleString()} 젠 포인트 사용`}
                        >
                            <Droplets size={15} />
                            청소하기
                        </button>
                    </div>
                    {!canAfford && (
                        <p className="text-sm text-red-400 font-medium text-center">젠 포인트가 부족합니다.</p>
                    )}
                </div>
            </div>
        </div>
    );
};
