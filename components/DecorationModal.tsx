import React from 'react';
import { X, Flower, Mountain, Lightbulb } from 'lucide-react';
import { DecorationType, Decoration } from '../types';

interface DecorationModalProps {
    onClose: () => void;
    zenPoints: number;
    onBuyDecoration: (type: DecorationType, cost: number) => void;
}

export const DecorationModal: React.FC<DecorationModalProps> = ({ onClose, zenPoints, onBuyDecoration }) => {
    const decorations = [
        { type: DecorationType.LILY_PAD, name: '연꽃잎', cost: 500, icon: <Flower className="text-green-500" size={32} />, description: '물 위에 떠 있는 평화로운 연꽃잎입니다.' },
        { type: DecorationType.ROCK, name: '바위', cost: 1000, icon: <Mountain className="text-gray-500" size={32} />, description: '연못에 자연스러운 느낌을 더해주는 바위입니다.' },
        { type: DecorationType.LANTERN, name: '등불', cost: 2000, icon: <Lightbulb className="text-yellow-300" size={32} />, description: '밤을 밝혀주는 은은한 등불입니다.' },
    ];

    return (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full max-h-[85vh] overflow-y-auto border border-gray-700 shadow-xl custom-scrollbar glass-panel" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-yellow-300">연못 꾸미기</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="연못 꾸미기 닫기"><X /></button>
                </div>

                <div className="mb-4 p-3 bg-gray-900/50 rounded-lg border border-gray-700 glass-section">
                    <p className="text-gray-300">현재 보유 ZP: <span className="text-yellow-300 font-bold">{zenPoints.toLocaleString()}</span></p>
                </div>

                <div className="space-y-4">
                    {decorations.map((deco) => (
                        <div key={deco.type} className="flex items-center justify-between bg-gray-700/50 p-4 rounded-lg border border-gray-600 hover:bg-gray-700 transition-colors glass-section">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center border border-gray-600 glass-input">
                                    {deco.icon}
                                </div>
                                <div>
                                    <h3 className="font-bold text-white">{deco.name}</h3>
                                    <p className="text-xs text-gray-400">{deco.description}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => onBuyDecoration(deco.type, deco.cost)}
                                disabled={zenPoints < deco.cost}
                                className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                aria-label={`${deco.name} 구매하기, ${deco.cost.toLocaleString()} 젠 포인트`}
                            >
                                {deco.cost.toLocaleString()} ZP
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
