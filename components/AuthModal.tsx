import React, { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Mail, UserRound, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './AuthModal.css';
import { isInAppBrowser } from '../utils/userAgent';
import { resumeLocalGameSave, suppressLocalGameSave } from '../services/localSave';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const { login, loginWithEmail, signUpWithEmail, user, loading } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [nickname, setNickname] = useState('');
    const [formError, setFormError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (!isOpen) return;

        // A successful guest session used to leave this flag set while the
        // component stayed mounted. Re-opening the auth modal then disabled
        // every control, even though no request was running anymore.
        setIsSubmitting(false);
    }, [isOpen]);

    if (!isOpen) return null;
    if (loading) {
        return (
            <div className="auth-modal-overlay">
                <div className="auth-modal-content">
                    <div className="auth-loading">
                        <div className="auth-spinner"></div>
                    </div>
                </div>
            </div>
        );
    }

    // 이미 로그인 된 상태라면 모달 닫기 (이펙트로 처리하는 게 더 깔끔할 수 있음)
    // An anonymous Firebase user represents the local/guest mode. It must be
    // possible to open this modal from that mode to sign in or simply close it
    // and continue playing locally.
    if (user && !user.isAnonymous) {
        onClose();
        return null;
    }

    const handleGoogleLogin = async () => {
        if (isSubmitting) return;

        try {
            setIsSubmitting(true);
            suppressLocalGameSave();
            await login();
        } catch (error) {
            console.error("Google login failed:", error);
            resumeLocalGameSave();
            setIsSubmitting(false);
            const message = error instanceof Error ? error.message : '';
            const code = typeof error === 'object' && error && 'code' in error
                ? String((error as { code?: string }).code)
                : '';

            if (code === 'auth/operation-not-allowed') {
                alert("Firebase Authentication에서 Google 로그인을 먼저 활성화해주세요.");
                return;
            }

            if (code === 'auth/unauthorized-domain' || message.includes('unauthorized-domain')) {
                alert("Firebase Authentication Authorized domains에 현재 도메인을 추가해야 합니다.");
                return;
            }

            alert("로그인 실패: 다시 시도해주세요.");
        }
    };

    const getEmailAuthErrorCode = (error: unknown) => {
        return typeof error === 'object' && error && 'code' in error
            ? String((error as { code?: string }).code)
            : '';
    };

    const getEmailAuthErrorMessage = (error: unknown) => {
        const code = getEmailAuthErrorCode(error);

        switch (code) {
            case 'auth/email-already-in-use':
                return '이미 가입된 이메일입니다. 로그인으로 전환해주세요.';
            case 'auth/invalid-email':
                return '이메일 형식이 올바르지 않습니다.';
            case 'auth/invalid-credential':
            case 'auth/user-not-found':
            case 'auth/wrong-password':
                return '이메일 또는 비밀번호가 올바르지 않습니다.';
            case 'auth/weak-password':
                return '비밀번호는 최소 6자 이상으로 입력해주세요.';
            case 'auth/operation-not-allowed':
                return 'Firebase Authentication에서 이메일/비밀번호 로그인을 활성화해주세요.';
            case 'auth/too-many-requests':
                return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
            default:
                return authMode === 'signup' ? '회원가입에 실패했습니다. 다시 시도해주세요.' : '로그인에 실패했습니다. 다시 시도해주세요.';
        }
    };

    const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isSubmitting) return;

        const trimmedEmail = email.trim();
        const enteredPassword = password;
        const trimmedNickname = nickname.trim();

        if (!trimmedEmail) {
            setFormError('이메일을 입력해주세요.');
            return;
        }

        if (enteredPassword.length < 6) {
            setFormError('비밀번호는 최소 6자 이상으로 입력해주세요.');
            return;
        }

        if (authMode === 'signup' && trimmedNickname.length < 2) {
            setFormError('닉네임은 최소 2자 이상으로 입력해주세요.');
            return;
        }

        try {
            setIsSubmitting(true);
            setFormError('');
            suppressLocalGameSave();

            if (authMode === 'signup') {
                await signUpWithEmail(trimmedEmail, enteredPassword, trimmedNickname);
            } else {
                await loginWithEmail(trimmedEmail, enteredPassword);
            }
        } catch (error) {
            console.error("Email auth failed:", error);
            resumeLocalGameSave();
            setIsSubmitting(false);
            const code = getEmailAuthErrorCode(error);
            if (authMode === 'signup' && code === 'auth/email-already-in-use') {
                setAuthMode('login');
                setFormError('이미 가입된 이메일입니다. 로그인으로 전환했어요. 비밀번호를 입력해 로그인해주세요.');
                return;
            }
            setFormError(getEmailAuthErrorMessage(error));
        }
    };

    return (
        <div className="auth-modal-overlay">
            <div className="auth-modal-content" onClick={event => event.stopPropagation()}>
                <div className="auth-modal-header">
                    <h1 className="auth-title">Koiworld</h1>
                    <button
                        className="auth-close-button"
                        type="button"
                        onClick={onClose}
                        aria-label="로그인 창 닫기"
                    >
                        <X size={22} strokeWidth={2} />
                    </button>
                </div>
                <div className="auth-modal-body">
                    <p className="auth-description">
                        아름다운 잉어들과 함께하는 힐링의 시간<br />
                        로그인하고 나만의 연못을 저장하세요.
                    </p>

                    {isInAppBrowser() && (
                        <div className="auth-browser-alert">
                            <strong>접속 환경 알림</strong><br />
                            카카오톡/인앱 브라우저에서는 구글 정책으로 인해 로그인이 차단될 수 있습니다.<br />
                            우측 하단/상단 메뉴의 <strong>[다른 브라우저로 열기]</strong>를 통해 Chrome이나 Safari에서 접속해주세요.
                        </div>
                    )}

                    <div className="auth-tabs" role="tablist" aria-label="이메일 인증 방식">
                        <button
                            type="button"
                            className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                            onClick={() => {
                                setAuthMode('login');
                                setFormError('');
                            }}
                        >
                            로그인
                        </button>
                        <button
                            type="button"
                            className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                            onClick={() => {
                                setAuthMode('signup');
                                setFormError('');
                            }}
                        >
                            회원가입
                        </button>
                    </div>

                    <form className="auth-form" onSubmit={handleEmailSubmit}>
                        {authMode === 'signup' && (
                            <label className="auth-field">
                                <UserRound className="auth-field-icon" size={20} strokeWidth={2.2} />
                                <input
                                    className="auth-input"
                                    type="text"
                                    value={nickname}
                                    onChange={event => setNickname(event.target.value)}
                                    placeholder="닉네임"
                                    autoComplete="nickname"
                                    disabled={isSubmitting}
                                />
                            </label>
                        )}
                        <label className="auth-field">
                            <Mail className="auth-field-icon" size={20} strokeWidth={2.2} />
                            <input
                                className="auth-input"
                                type="email"
                                value={email}
                                onChange={event => setEmail(event.target.value)}
                                placeholder="이메일"
                                autoComplete="email"
                                disabled={isSubmitting}
                            />
                        </label>
                        <label className="auth-field">
                            <LockKeyhole className="auth-field-icon" size={20} strokeWidth={2.2} />
                            <input
                                className="auth-input"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={event => setPassword(event.target.value)}
                                placeholder="비밀번호"
                                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                                disabled={isSubmitting}
                            />
                            <button
                                className="auth-password-toggle"
                                type="button"
                                onClick={() => setShowPassword(prev => !prev)}
                                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                                disabled={isSubmitting}
                            >
                                {showPassword ? <EyeOff size={20} strokeWidth={2.2} /> : <Eye size={20} strokeWidth={2.2} />}
                            </button>
                        </label>
                        {formError && <p className="auth-error">{formError}</p>}
                        <button className="auth-btn email" type="submit" disabled={isSubmitting}>
                            {authMode === 'signup' ? '이메일로 회원가입' : '이메일로 로그인'}
                        </button>
                    </form>

                    <div className="divider">또는</div>

                    <button className="auth-btn google" type="button" onClick={handleGoogleLogin} disabled={isSubmitting}>
                        Google로 로그인
                    </button>

                </div>
            </div>
        </div>
    );
};
