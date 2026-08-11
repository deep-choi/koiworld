import React from 'react';
import { X, Check } from 'lucide-react';
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
            <div className="light-modal bg-white p-5 rounded-2xl max-w-sm w-full max-h-[85svh] overflow-y-auto border border-slate-200 shadow-2xl light-scrollbar" onClick={e => e.stopPropagation()}>
                <div className="mb-5 pb-4 border-b border-slate-100">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-medium text-slate-900">배경 테마 변경</h2>
                        <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors flex items-center justify-center" aria-label="테마 선택 닫기">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="mb-4 text-sm text-slate-500">
                    <p>모든 테마를 <span className="text-[#f97316] font-medium">무료</span>로 이용할 수 있습니다.</p>
                </div>

                <div className="space-y-4">
                    {themes.map((theme) => (
                        <button
                            type="button"
                            key={theme.type}
                            className={`w-full overflow-hidden text-left rounded-xl border-0 transition-colors ${currentTheme === theme.type
                                ? 'bg-orange-50 shadow-sm'
                                : 'bg-slate-50 hover:bg-slate-100'
                                }`}
                            onClick={() => {
                                if (currentTheme !== theme.type) {
                                    onSelectTheme(theme.type, theme.cost);
                                }
                            }}
                        >
                            <span className={`block w-full h-40 ${theme.color} shadow-inner`} aria-hidden="true" />
                            <span className="flex items-center justify-between gap-3 px-3 py-3">
                                <span className="text-base font-medium text-slate-900 truncate">{theme.name}</span>
                                <span className={`flex items-center shrink-0 text-sm font-medium ${currentTheme === theme.type ? 'text-[#f97316]' : 'text-slate-400'}`}>
                                    {currentTheme === theme.type && <Check size={17} className="mr-1" />}
                                    {currentTheme === theme.type ? '사용 중' : '무료'}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
