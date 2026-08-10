import React, { useEffect, useState } from 'react';
import { FilePlus, Menu, Moon, Music, RotateCcw, Settings, Speaker, Sun, User, X } from 'lucide-react';
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
            <div className="bg-gray-800 rounded-xl max-w-md w-full border border-gray-700 shadow-2xl overflow-hidden glass-panel modal-glass-panel" onClick={e => e.stopPropagation()}>
                {/* 헤더 */}
                <div className="flex justify-between items-center p-4 bg-gray-900 border-b border-gray-700 glass-header modal-glass-header">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Settings size={20} className="text-yellow-400" /> 설정
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" aria-label="설정 닫기">
                        <X size={24} />
                    </button>
                </div>

                {/* 탭 */}
                <div className="flex border-b border-gray-700 overflow-x-auto glass-header modal-glass-header">
                    <button
                        className={`flex-1 py-3 px-2 font-bold transition-colors whitespace-nowrap ${activeTab === 'settings' ? 'bg-white/20 text-purple-200' : 'text-white/70 hover:bg-white/10'}`}
                        onClick={() => setActiveTab('settings')}
                        type="button"
                        aria-label="설정 탭 열기"
                        aria-pressed={activeTab === 'settings'}
                    >
                        설정
                    </button>
                    <button
                        className={`flex-1 py-3 px-2 font-bold transition-colors whitespace-nowrap ${activeTab === 'new' ? 'bg-white/20 text-red-200' : 'text-white/70 hover:bg-white/10'}`}
                        onClick={() => setActiveTab('new')}
                        type="button"
                        aria-label="새 게임 탭 열기"
                        aria-pressed={activeTab === 'new'}
                    >
                        새 게임
                    </button>
                </div>

                {/* 내용 */}
                <div className="p-4 min-h-[300px]">
                    {activeTab === 'settings' && (
                        <div className="space-y-6 pt-4">
                            <div className="text-sm text-gray-300 bg-gray-900/30 border border-gray-700 rounded-lg p-3 glass-section modal-glass-section">
                                게임 진행은 자동 저장됩니다. 로그인하면 계정에도 자동 저장됩니다.
                            </div>

                            {/* 배경 음악 */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-gray-300">
                                    <span className="flex items-center gap-2"><Music size={18} /> 배경 음악</span>
                                    <span className="font-mono text-sm text-white/70">{Math.round(bgmVolume * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={bgmVolume}
                                    onChange={handleBgmChange}
                                    className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                                />
                            </div>

                            {/* 효과음 */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-gray-300">
                                    <span className="flex items-center gap-2"><Speaker size={18} /> 효과음</span>
                                    <span className="font-mono text-sm text-white/70">{Math.round(sfxVolume * 100)}%</span>
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
                                    className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                />
                            </div>


                        </div>
                    )}

                    {activeTab === 'new' && (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-center space-y-6">
                            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center text-red-400">
                                <FilePlus size={40} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-white mb-2">새 게임 시작</h3>
                                <p className="text-gray-400 text-sm max-w-xs mx-auto">
                                    현재 진행 상황을 모두 초기화하고<br />새로운 연못에서 시작합니다.
                                </p>
                            </div>
                            <button
                                onClick={handleNewGame}
                                disabled={isStartingNewGame}
                                className={`font-bold py-3 px-8 rounded-full shadow-lg transition-all flex items-center gap-2 ${isStartingNewGame
                                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                    : 'bg-red-600 hover:bg-red-500 text-white transform hover:scale-105'
                                }`}
                                type="button"
                                aria-label={isStartingNewGame ? '새 게임 초기화 진행 중' : '새 게임 시작하기'}
                            >
                                <RotateCcw size={20} />
                                {isStartingNewGame ? '초기화 중...' : '새 게임 시작하기'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
