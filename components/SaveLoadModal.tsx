import React, { useEffect, useState } from 'react';
import { Music, Speaker, X } from 'lucide-react';
import { audioManager } from '../utils/audio';
import { useAuth } from '../contexts/AuthContext';
import { broadcastForceClear, resumeLocalGameSave, suppressLocalGameSave } from '../services/localSave';

interface SaveLoadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onNewGame: () => Promise<boolean>;
    isNight: boolean;
    onToggleDayNight: () => void;
}

export const SaveLoadModal: React.FC<SaveLoadModalProps> = ({
    isOpen,
    onClose,
    onNewGame,
    isNight,
    onToggleDayNight,
}) => {
    const [activeTab, setActiveTab] = useState<'settings' | 'new'>('settings');
    const [bgmVolume, setBgmVolume] = useState(0.3);
    const [sfxVolume, setSfxVolume] = useState(0.5);
    const [isStartingNewGame, setIsStartingNewGame] = useState(false);
    const { user } = useAuth();

    useEffect(() => {
        if (!isOpen) return;
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

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="light-modal bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* 헤더 */}
                <div className="flex justify-between items-center px-5 pt-5">
                    <h2 className="text-xl font-medium text-slate-900">
                        설정
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors flex items-center justify-center" aria-label="설정 닫기">
                        <X size={18} />
                    </button>
                </div>

                {/* 탭 */}
                <div className="flex gap-2 px-5 pt-4">
                    <button
                        className={`flex-1 py-3 px-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'settings' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                        onClick={() => setActiveTab('settings')}
                        type="button"
                        aria-label="사운드 탭 열기"
                        aria-pressed={activeTab === 'settings'}
                    >
                        사운드
                    </button>
                    <button
                        className={`flex-1 py-3 px-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'new' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                        onClick={() => setActiveTab('new')}
                        type="button"
                        aria-label="새 게임 탭 열기"
                        aria-pressed={activeTab === 'new'}
                    >
                        새 게임
                    </button>
                </div>

                {/* 내용 */}
                <div className="px-5 pb-9 pt-5">
                    {activeTab === 'settings' && (
                        <div className="space-y-6">
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

                    {activeTab === 'new' && (
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
