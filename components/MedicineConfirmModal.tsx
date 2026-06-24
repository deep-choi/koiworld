import React from 'react';
import { X, Pill, FlaskConical } from 'lucide-react';

interface MedicineConfirmModalProps {
    onClose: () => void;
    onConfirm: () => void;
    currentCount: number;
}

export const MedicineConfirmModal: React.FC<MedicineConfirmModalProps> = ({ onClose, onConfirm, currentCount }) => {
    const remaining = Math.max(0, currentCount - 1);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-gray-900 border border-gray-700 p-6 rounded-2xl w-full max-w-sm shadow-2xl animate-fade-in">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                    aria-label="치료제 사용 확인창 닫기"
                >
                    <X size={20} />
                </button>

                <div className="flex flex-col items-center gap-4 text-center">
                    <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-2">
                        <Pill className="text-green-400 w-8 h-8" />
                    </div>

                    <h2 className="text-xl font-bold text-white">치료제 사용</h2>

                    <div className="space-y-1 text-gray-300">
                        <p>모든 코이에게 치료제를 사용하시겠습니까?</p>
                        <p className="text-sm text-gray-400">병에 걸린 코이가 회복되고 건강해집니다.</p>
                    </div>

                    <div className="bg-gray-800/50 rounded-lg p-3 w-full border border-gray-700 mt-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-400">보유 치료제</span>
                            <span className="font-bold text-green-400">{currentCount}개</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-1">
                            <span className="text-gray-400">소모</span>
                            <span className="font-bold text-red-400">-1개</span>
                        </div>
                        <div className="h-px bg-gray-700 my-2" />
                        <div className="flex justify-between items-center text-sm font-bold">
                            <span className="text-gray-300">사용 후 잔여</span>
                            <span className="text-white">
                                {remaining}개
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full mt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold transition-all"
                            aria-label="치료제 사용 취소"
                        >
                            취소
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
                            aria-label="모든 코이에게 치료제 사용하기"
                        >
                            <FlaskConical size={18} />
                            사용하기
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
