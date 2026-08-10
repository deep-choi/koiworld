import React, { useState, useEffect } from 'react';
import { X, User, LogOut, Check, Edit2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { audioManager } from '../utils/audio';
import { broadcastForceClear, resumeLocalGameSave, suppressLocalGameSave } from '../services/localSave';

interface AccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    userNickname: string;
    onSaveNickname: (nickname: string) => Promise<void>;
    onLogoutCleanup: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
    isOpen,
    onClose,
    userNickname,
    onSaveNickname,
    onLogoutCleanup,
}) => {
    const { user, logout } = useAuth();
    const [nicknameInput, setNicknameInput] = useState(userNickname);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setNicknameInput(userNickname);
            setError(null);
            setSuccess(false);
        }
    }, [isOpen, userNickname]);

    if (!isOpen) return null;

    const handleSaveNickname = async () => {
        const trimmed = nicknameInput.trim();
        if (!trimmed) {
            setError('닉네임을 입력해주세요.');
            return;
        }
        if (trimmed === userNickname) {
            onClose();
            return;
        }

        try {
            setIsSaving(true);
            setError(null);
            audioManager.playSFX('click');
            await onSaveNickname(trimmed);
            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                onClose();
            }, 1000);
        } catch (err) {
            setError('닉네임 저장에 실패했습니다.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogout = async () => {
        if (isLoggingOut) return;
        if (!window.confirm('정말 로그아웃 하시겠습니까? 진행 데이터는 계정에 안전하게 저장됩니다.')) return;

        try {
            suppressLocalGameSave();
            setIsLoggingOut(true);
            audioManager.playSFX('click');
            await logout();
            broadcastForceClear();
            onClose();
            onLogoutCleanup();
        } catch (err) {
            resumeLocalGameSave();
            alert('로그아웃에 실패했습니다.');
        } finally {
            setIsLoggingOut(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={onClose}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl scale-in" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-gray-900/50">
                    <h2 className="text-xl font-black text-white flex items-center gap-2">
                        <User size={20} className="text-cyan-400" /> 계정 정보
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="계정 정보 닫기">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    {/* User Info Card */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="relative">
                            {user?.photoURL ? (
                                <img src={user.photoURL.replace(/^http:\/\//i, 'https://')} alt="Profile" className="w-20 h-20 rounded-full border-2 border-cyan-400/30" />
                            ) : (
                                <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 border-2 border-gray-700">
                                    <User size={40} />
                                </div>
                            )}
                            <div className="absolute bottom-0 right-0 w-6 h-6 bg-green-500 border-4 border-gray-900 rounded-full" title="Online" />
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-white">{user?.displayName || '게스트'}</p>
                            <p className="text-xs text-gray-500">{user?.email || 'Guest Session'}</p>
                        </div>
                    </div>

                    {/* Authentication Status */}
                    <div className={`rounded-2xl border p-4 ${user?.isAnonymous
                        ? 'border-amber-400/20 bg-amber-400/5'
                        : 'border-emerald-400/20 bg-emerald-400/5'
                        }`}>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">로그인 방식</p>
                                <p className={`mt-1 text-base font-black ${user?.isAnonymous ? 'text-amber-300' : 'text-emerald-300'}`}>
                                    {user?.authSourceLabel ?? user?.providerLabel ?? '확인 중'}
                                </p>
                            </div>
                            <div className={`flex h-9 w-9 items-center justify-center rounded-full ${user?.isAnonymous ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'
                                }`} aria-hidden="true">
                                <User size={18} />
                            </div>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-gray-400">
                            {user?.isAnonymous
                                ? '현재 게스트 모드입니다. Play Games 계정과 아직 연결되지 않았습니다.'
                                : user?.authSource === 'playgames'
                                    ? 'Play Games 자동 로그인으로 Google 계정에 연결되어 다른 기기에서도 게임 데이터를 이어갈 수 있습니다.'
                                : 'Firebase 계정에 연결되어 다른 기기에서도 게임 데이터를 이어갈 수 있습니다.'}
                        </p>
                    </div>

                    {/* Nickname Section */}
                    <div className="space-y-3">
                        <label className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                            <Edit2 size={12} /> 닉네임 변경
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={nicknameInput}
                                onChange={e => setNicknameInput(e.target.value)}
                                className="w-full bg-gray-800/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 transition-all font-bold"
                                placeholder="닉네임 입력"
                                maxLength={20}
                            />
                            <button
                                onClick={handleSaveNickname}
                                disabled={isSaving || success}
                                className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all ${success ? 'bg-green-500 text-white' : 'hover:bg-cyan-500/20 text-cyan-400'
                                    }`}
                                aria-label={success ? '닉네임 저장 완료' : '닉네임 저장하기'}
                            >
                                {isSaving ? <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent animate-spin rounded-full" /> :
                                    success ? <Check size={20} /> : <Check size={20} />}
                            </button>
                        </div>
                        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
                        <p className="text-[10px] text-gray-600">랭킹 시스템에 표시되는 이름입니다.</p>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-4 border-t border-white/5">
                        <button
                            onClick={handleLogout}
                            disabled={isLoggingOut}
                            className="w-full py-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all flex items-center justify-center gap-2 font-bold group"
                            aria-label={isLoggingOut ? '로그아웃 진행 중' : '로그아웃하기'}
                        >
                            <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
                            {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
