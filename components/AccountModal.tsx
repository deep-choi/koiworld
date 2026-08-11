import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Edit2, Gamepad2, LogOut, Mail, Phone, Save, Trash2, User, UserRound, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { audioManager } from '../utils/audio';
import { broadcastForceClear, clearLocalGameSaves, resumeLocalGameSave, suppressLocalGameSave } from '../services/localSave';

interface AccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    userNickname: string;
    profilePhotoURL: string | null;
    onSaveProfile: (nickname: string, photoURL: string | null) => Promise<void>;
    onLogoutCleanup: () => void;
}

const MAX_PROFILE_IMAGE_FILE_SIZE = 5 * 1024 * 1024;
const MAX_PROFILE_IMAGE_DATA_URL_LENGTH = 120_000;

const normalizeImageURL = (photoURL: string | null | undefined) =>
    photoURL?.replace(/^http:\/\//i, 'https://') ?? null;

const GoogleIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.35 12.27c0-.79-.07-1.55-.22-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.15c1.84-1.7 2.9-4.2 2.9-7.42Z" />
        <path fill="#34A853" d="M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.15-2.45c-.87.58-1.98.92-3.3.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.74 9.74 0 0 0 12 21.5Z" />
        <path fill="#FBBC05" d="M6.53 13.58A5.86 5.86 0 0 1 6.22 12c0-.55.11-1.08.31-1.58V7.89H3.28A9.5 9.5 0 0 0 2.25 12c0 1.48.35 2.88 1.03 4.11l3.25-2.53Z" />
        <path fill="#EA4335" d="M12 6.39c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.48 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.72 5.39l3.25 2.53C7.3 8.11 9.46 6.39 12 6.39Z" />
    </svg>
);

const LoginMethodIcon: React.FC<{ source?: string }> = ({ source }) => {
    if (source === 'google') return <GoogleIcon />;
    if (source === 'playgames') return <Gamepad2 size={20} className="text-green-400" />;
    if (source === 'email') return <Mail size={20} className="text-yellow-300" />;
    if (source === 'phone') return <Phone size={20} className="text-yellow-300" />;
    return <UserRound size={20} className="text-yellow-300" />;
};

const resizeProfileImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
    reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('이미지를 처리할 수 없습니다.'));
        image.onload = () => {
            const maxSize = 256;
            const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * ratio));
            canvas.height = Math.max(1, Math.round(image.height * ratio));

            const context = canvas.getContext('2d');
            if (!context) {
                reject(new Error('이미지 캔버스를 만들 수 없습니다.'));
                return;
            }

            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL('image/jpeg', 0.82);
            if (dataURL.length > MAX_PROFILE_IMAGE_DATA_URL_LENGTH) {
                reject(new Error('이미지 용량이 너무 큽니다. 더 작은 이미지를 선택해주세요.'));
                return;
            }

            resolve(dataURL);
        };
        image.src = String(reader.result);
    };

    reader.readAsDataURL(file);
});

export const AccountModal: React.FC<AccountModalProps> = ({
    isOpen,
    onClose,
    userNickname,
    profilePhotoURL,
    onSaveProfile,
    onLogoutCleanup,
}) => {
    const { user, logout, deleteAccount } = useAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [nicknameInput, setNicknameInput] = useState(userNickname);
    const [selectedPhotoURL, setSelectedPhotoURL] = useState<string | null>(null);
    const [initialPhotoURL, setInitialPhotoURL] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessingImage, setIsProcessingImage] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [requiresReauthPassword, setRequiresReauthPassword] = useState(false);
    const [reauthPassword, setReauthPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const currentPhotoURL = profilePhotoURL ?? user?.photoURL ?? null;
            setNicknameInput(userNickname);
            setSelectedPhotoURL(currentPhotoURL);
            setInitialPhotoURL(currentPhotoURL);
            setError(null);
            setSuccess(false);
            setRequiresReauthPassword(false);
            setReauthPassword('');
        }
    }, [isOpen, profilePhotoURL, user?.photoURL, userNickname]);

    if (!isOpen) return null;

    const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            setError('이미지 파일만 선택할 수 있습니다.');
            return;
        }
        if (file.size > MAX_PROFILE_IMAGE_FILE_SIZE) {
            setError('이미지는 5MB 이하만 선택할 수 있습니다.');
            return;
        }

        try {
            setIsProcessingImage(true);
            setError(null);
            const resizedImage = await resizeProfileImage(file);
            setSelectedPhotoURL(resizedImage);
        } catch (imageError) {
            setError(imageError instanceof Error ? imageError.message : '프로필 이미지 처리에 실패했습니다.');
        } finally {
            setIsProcessingImage(false);
        }
    };

    const handleSaveProfile = async () => {
        const trimmed = nicknameInput.trim();
        if (!trimmed) {
            setError('닉네임을 입력해주세요.');
            return;
        }
        if (trimmed === userNickname && selectedPhotoURL === initialPhotoURL) {
            onClose();
            return;
        }

        try {
            setIsSaving(true);
            setError(null);
            audioManager.playSFX('click');
            await onSaveProfile(trimmed, selectedPhotoURL);
            setSuccess(true);
            window.setTimeout(() => {
                setSuccess(false);
                onClose();
            }, 700);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : '프로필 저장에 실패했습니다.');
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
        } catch (logoutError) {
            resumeLocalGameSave();
            alert('로그아웃에 실패했습니다.');
        } finally {
            setIsLoggingOut(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (isDeletingAccount) return;
        const confirmed = window.confirm(
            '계정을 삭제하면 Firebase 계정, 클라우드 게임 데이터, 랭킹 기록과 이 기기의 저장 데이터가 모두 삭제됩니다. 계속하시겠습니까?',
        );
        if (!confirmed) return;

        try {
            suppressLocalGameSave();
            setIsDeletingAccount(true);
            setError(null);
            await deleteAccount(reauthPassword || undefined);
            clearLocalGameSaves();
            broadcastForceClear();
            onClose();
            onLogoutCleanup();
            resumeLocalGameSave();
            window.location.reload();
        } catch (deleteError) {
            resumeLocalGameSave();
            const code = typeof deleteError === 'object' && deleteError && 'code' in deleteError
                ? String((deleteError as { code?: string }).code ?? '')
                : '';
            if (code === 'auth/password-required' || user?.providerIds.includes('password')) {
                setRequiresReauthPassword(true);
            }
            setError(code === 'auth/requires-recent-login'
                ? '보안을 위해 최근 로그인 후 계정 삭제가 가능합니다. 로그아웃한 뒤 다시 로그인하고 재시도해주세요.'
                : deleteError instanceof Error
                    ? deleteError.message
                    : '계정 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.');
        } finally {
            setIsDeletingAccount(false);
        }
    };

    const displayPhotoURL = normalizeImageURL(selectedPhotoURL);

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-gray-800 rounded-xl max-w-md w-full max-h-[calc(100svh-2rem)] border border-gray-700 shadow-2xl overflow-y-auto glass-panel" onClick={event => event.stopPropagation()}>
                <div className="flex justify-between items-center p-3.5 bg-gray-900 border-b border-gray-700 glass-header">
                    <h2 className="text-xl font-black text-white flex items-center gap-2">
                        <User size={20} className="text-yellow-400" /> 계정 정보
                    </h2>
                    <button onClick={onClose} className="text-white/65 hover:text-white transition-colors" aria-label="계정 정보 닫기">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    <div className="flex flex-col items-center gap-2">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="relative group rounded-full"
                            aria-label="프로필 이미지 변경"
                            disabled={isProcessingImage || isSaving}
                        >
                            {displayPhotoURL ? (
                                <img
                                    src={displayPhotoURL}
                                    alt="프로필 이미지"
                                    className="w-[72px] h-[72px] rounded-full border-2 border-yellow-400/60 object-cover"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <div className="w-[72px] h-[72px] rounded-full bg-gray-800 flex items-center justify-center text-white/60 border-2 border-gray-700 glass-input">
                                    <User size={36} />
                                </div>
                            )}
                            <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-yellow-500 text-gray-950 border-[3px] border-gray-900 flex items-center justify-center group-hover:bg-yellow-300 transition-colors">
                                <Camera size={13} />
                            </span>
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoChange}
                            className="hidden"
                        />
                        <div className="text-center">
                            <p className="text-base font-bold text-white">{user?.displayName || '게스트'}</p>
                            <p className="text-xs text-white/75">{user?.email || '게스트 계정'}</p>
                        </div>
                    </div>

                    <div className="rounded-lg border border-gray-700 p-3 bg-gray-900/30 glass-section">
                        <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-950/30">
                                <LoginMethodIcon source={user?.authSource} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-white/75">로그인 방식</p>
                                <p className={`mt-0.5 text-base font-black ${user?.isAnonymous ? 'text-yellow-300' : 'text-emerald-300'}`}>
                                    {user?.authSourceLabel ?? '확인 중'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-white/75 uppercase tracking-widest flex items-center gap-2">
                            <Edit2 size={12} /> 닉네임
                        </label>
                        <input
                            type="text"
                            value={nicknameInput}
                            onChange={event => setNicknameInput(event.target.value)}
                            className="w-full bg-gray-800/50 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-yellow-500/60 transition-all font-bold glass-input"
                            placeholder="닉네임 입력"
                            maxLength={20}
                        />
                        <p className="text-[10px] text-white/55">랭킹 시스템에 표시되는 이름입니다.</p>
                    </div>

                    {requiresReauthPassword && (
                        <div className="space-y-2 rounded-xl border border-red-400/20 bg-red-500/5 p-3">
                            <label className="text-xs font-bold text-red-200" htmlFor="account-deletion-password">
                                계정 삭제를 위해 이메일 비밀번호를 다시 입력해주세요.
                            </label>
                            <input
                                id="account-deletion-password"
                                type="password"
                                value={reauthPassword}
                                onChange={event => setReauthPassword(event.target.value)}
                                autoComplete="current-password"
                                className="w-full bg-gray-900/60 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-red-400/60 transition-all"
                                placeholder="비밀번호"
                            />
                        </div>
                    )}
                    {error && <p className="text-red-400 text-xs leading-relaxed">{error}</p>}

                    <div className="pt-3 border-t border-white/15 space-y-2">
                        <button
                            onClick={handleSaveProfile}
                            disabled={isSaving || isProcessingImage || success}
                            className={`w-full py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 font-bold ${success
                                ? 'bg-green-500 text-white'
                                : 'bg-yellow-500 hover:bg-yellow-400 text-gray-950 border border-yellow-400'
                                } disabled:opacity-60`}
                            aria-label={success ? '프로필 저장 완료' : '프로필 저장하기'}
                        >
                            {isSaving || isProcessingImage ? <div className="w-5 h-5 border-2 border-yellow-300 border-t-transparent animate-spin rounded-full" /> : success ? <Check size={18} /> : <Save size={18} />}
                            {isProcessingImage ? '이미지 처리 중...' : isSaving ? '저장 중...' : success ? '저장 완료' : '저장'}
                        </button>
                        <button
                            onClick={handleLogout}
                            disabled={isLoggingOut || isDeletingAccount}
                            className="w-full py-2.5 rounded-xl bg-transparent hover:bg-white/10 text-red-300 border border-transparent transition-all flex items-center justify-center gap-2 font-bold group"
                            aria-label={isLoggingOut ? '로그아웃 진행 중' : '로그아웃하기'}
                        >
                            <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
                            {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
                        </button>
                        <button
                            onClick={handleDeleteAccount}
                            disabled={isLoggingOut || isDeletingAccount}
                            className="w-full py-2.5 rounded-xl bg-transparent hover:bg-red-500/10 text-red-400 border border-red-400/20 transition-all flex items-center justify-center gap-2 font-bold disabled:opacity-60"
                            aria-label={isDeletingAccount ? '계정 삭제 진행 중' : '계정 삭제하기'}
                        >
                            <Trash2 size={18} />
                            {isDeletingAccount ? '계정 삭제 중...' : requiresReauthPassword ? '비밀번호 확인 후 삭제' : '계정 삭제'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
