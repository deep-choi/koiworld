import React, { useEffect, useState } from 'react';
import { Music, Speaker, X, Megaphone, MessageCircle, Volume2, RotateCcw, ArrowLeft, ChevronRight } from 'lucide-react';
import { MENU_ICON, MENU_ICON_SIZE, MENU_LABEL, MENU_LIST, MENU_ROW, MENU_TRAILING, MODAL_BACK, MODAL_CLOSE, MODAL_TITLE } from './menuStyles';
import { audioManager } from '../utils/audio';
import type { CommunitySection } from './CommunityModal';

interface SaveLoadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onNewGame: () => Promise<boolean>;
    onCommunityClick: (section: CommunitySection) => void;
    isNight: boolean;
    onToggleDayNight: () => void;
}

type SettingsView = 'menu' | 'sound' | 'new';

const VIEW_TITLES: Record<SettingsView, string> = {
    menu: '설정',
    sound: '사운드',
    new: '새 게임',
};

export const SaveLoadModal: React.FC<SaveLoadModalProps> = ({
    isOpen,
    onClose,
    onNewGame,
    onCommunityClick,
    isNight,
    onToggleDayNight,
}) => {
    const [view, setView] = useState<SettingsView>('menu');
    const [bgmVolume, setBgmVolume] = useState(0.3);
    const [sfxVolume, setSfxVolume] = useState(0.5);
    const [isStartingNewGame, setIsStartingNewGame] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setView('menu');
        const vols = audioManager.getVolumes();
        setBgmVolume(vols.bgm);
        setSfxVolume(vols.sfx);
    }, [isOpen]);


    const handleBgmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setBgmVolume(val);
        audioManager.setBGMVolume(val);
    };

    const handleSfxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setSfxVolume(val);
        audioManager.setSFXVolume(val);
    };

    const handleSfxMouseUp = () => {
        audioManager.playSFX('click');
    };

    const handleNewGame = async () => {
        if (isStartingNewGame) return;

        try {
            setIsStartingNewGame(true);
            audioManager.playSFX('click');
            const ok = await onNewGame();
            if (ok) {
                onClose();
            }
        } finally {
            setIsStartingNewGame(false);
        }
    };


    if (!isOpen) return null;

    const menuItems = [
        { label: '소식', Icon: Megaphone, onClick: () => onCommunityClick('news') },
        { label: '커뮤니티', Icon: MessageCircle, onClick: () => onCommunityClick('community') },
        { label: '사운드', Icon: Volume2, onClick: () => setView('sound') },
        { label: '새 게임', Icon: RotateCcw, onClick: () => setView('new') },
    ];

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="light-modal bg-white rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto border border-slate-200 shadow-2xl" onClick={e => e.stopPropagation()}>
                {/* 헤더 */}
                <div className="flex items-center gap-2 px-5 pt-5">
                    {view !== 'menu' && (
                        <button onClick={() => setView('menu')} className={MODAL_BACK} aria-label="설정 메뉴로 돌아가기" type="button">
                            <ArrowLeft size={20} />
                        </button>
                    )}
                    <h2 className={MODAL_TITLE}>
                        {VIEW_TITLES[view]}
                    </h2>
                    <button onClick={onClose} className={MODAL_CLOSE} aria-label="설정 닫기" type="button">
                        <X size={18} />
                    </button>
                </div>

                {/* 내용 */}
                <div className="px-5 pb-6 pt-5">
                    {view === 'menu' && (
                        <div className={MENU_LIST}>
                            {menuItems.map(({ label, Icon, onClick }) => (
                                <button
                                    key={label}
                                    type="button"
                                    onClick={onClick}
                                    className={MENU_ROW}
                                >
                                    <Icon size={MENU_ICON_SIZE} className={MENU_ICON} />
                                    <span className={MENU_LABEL}>{label}</span>
                                    <ChevronRight size={18} className={MENU_TRAILING} />
                                </button>
                            ))}
                        </div>
                    )}

                    {view === 'sound' && (
                        <div className="space-y-6 pb-3">
                            {/* 배경 음악 */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-slate-600">
                                <span className="flex items-center gap-2 text-sm font-medium"><Music size={18} className="text-orange-500" /> 배경 음악</span>
                                    <span className="font-mono text-sm text-slate-500">{Math.round(bgmVolume * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={bgmVolume}
                                    onChange={handleBgmChange}
                                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                />
                            </div>

                            {/* 효과음 */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-slate-600">
                                    <span className="flex items-center gap-2 text-sm font-medium"><Speaker size={18} className="text-purple-500" /> 효과음</span>
                                    <span className="font-mono text-sm text-slate-500">{Math.round(sfxVolume * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={sfxVolume}
                                    onChange={handleSfxChange}
                                    onMouseUp={handleSfxMouseUp}
                                    onTouchEnd={handleSfxMouseUp}
                                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                />
                            </div>
                        </div>
                    )}

                    {view === 'new' && (
                        <div className="flex flex-col py-3 text-center space-y-6">
                            <div>
                                <h3 className="text-xl font-medium text-slate-900 mb-2">새 게임 시작</h3>
                                <p className="text-slate-500 text-sm leading-relaxed max-w-xs mx-auto">
                                    현재 진행 상황을 모두 초기화하고<br />새로운 연못에서 시작합니다.
                                </p>
                            </div>
                            <button
                                onClick={handleNewGame}
                                disabled={isStartingNewGame}
                                className={`w-full font-medium py-3 px-8 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${isStartingNewGame
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : 'bg-orange-500 hover:bg-orange-600 text-white'
                                }`}
                                type="button"
                                aria-label={isStartingNewGame ? '새 게임 초기화 진행 중' : '새 게임 시작하기'}
                            >
                                {isStartingNewGame ? '초기화 중...' : '새 게임 시작하기'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
