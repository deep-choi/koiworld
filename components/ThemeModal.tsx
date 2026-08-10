import React from 'react';
import { X, Image, Check } from 'lucide-react';
import { PondTheme } from '../types';

interface ThemeModalProps {
    onClose: () => void;
    zenPoints: number;
    currentTheme: PondTheme;
    onSelectTheme: (theme: PondTheme, cost: number) => void;
}

export const ThemeModal: React.FC<ThemeModalProps> = ({ onClose, zenPoints, currentTheme, onSelectTheme }) => {
    const themes = [
        { type: PondTheme.DEFAULT, name: '기본 (맑은 물)', cost: 0, color: 'bg-[radial-gradient(circle_at_center,_rgb(207,250,254),_rgb(191,219,254),_rgb(241,245,249))]' },
        { type: PondTheme.MUD, name: '진흙 바닥', cost: 0, color: 'bg-[radial-gradient(circle_at_center,_rgba(126,95,55,1),_rgba(66,45,20,1))]' },
        { type: PondTheme.MOSS, name: '이끼 낀 연못', cost: 0, color: 'bg-[radial-gradient(circle_at_center,_rgba(95,168,121,1),_rgba(27,73,48,1))]' },
    ];

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-gray-800 p-6 rounded-lg max-w-2xl w-full max-h-[85svh] overflow-y-auto border border-gray-700 shadow-xl custom-scrollbar glass-panel" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-yellow-300">배경 테마 변경</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="테마 선택 닫기"><X /></button>
                </div>

                <div className="mb-5 text-sm text-gray-300">
                    <p className="text-gray-300">모든 테마를 <span className="text-green-400 font-bold">무료</span>로 이용할 수 있습니다!</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                    {themes.map((theme) => (
                        <div
                            key={theme.type}
                            className={`relative p-4 rounded-lg border transition-all cursor-pointer hover:scale-[1.02] ${currentTheme === theme.type ? 'border-green-500 bg-green-500/15' : 'border-white/20 bg-white/10 hover:border-white/40'}`}
                            onClick={() => {
                                if (currentTheme !== theme.type) {
                                    onSelectTheme(theme.type, theme.cost);
                                }
                            }}
                        >
                            <div className={`w-full h-24 rounded-md mb-3 ${theme.color} shadow-inner`}></div>
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-white">{theme.name}</h3>
                                {currentTheme === theme.type ? (
                                    <span className="flex items-center text-green-400 font-bold text-sm"><Check size={16} className="mr-1" /> 사용 중</span>
                                ) : (
                                    <span className="font-bold text-sm text-green-400">무료</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
