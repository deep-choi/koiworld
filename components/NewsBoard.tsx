import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, EyeOff, PenLine, Pin, Upload } from 'lucide-react';
import { MENU_LIST, MENU_TRAILING } from './menuStyles';
import { deleteNewsPost, fetchNews, readCachedNews, saveNewsPost, watchIsAdmin, type NewsDraft } from '../services/news';
import {
    choosePosts, formatPostDate, missingBundledPosts, NEWS_BODY_MAX, NEWS_TITLE_MAX, toDateInput, toParagraphs,
    type NewsKind, type NewsPost,
} from '../utils/newsPosts';

export const KIND_LABEL: Record<NewsKind, string> = { notice: '공지사항', update: '업데이트' };

const PRIMARY = 'rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-60';
const SECONDARY = 'rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-60';
const FIELD = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100';
const LABEL = 'mb-1.5 block text-xs font-semibold text-slate-500';

/** Posts for the news screens, plus whether this account may write them. */
export function useNews(isOpen: boolean) {
    const [isAdmin, setIsAdmin] = useState(false);
    const [server, setServer] = useState<NewsPost[] | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => watchIsAdmin(setIsAdmin), []);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setServer(await fetchNews(isAdmin));
        } catch {
            setServer(null);  // offline or blocked: fall back to the cache or the bundled posts
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => { if (isOpen) void reload(); }, [isOpen, reload]);

    const posts = choosePosts(server, server ? null : readCachedNews());
    // Bundled posts are only offered for upload once the server answered.
    const unpublished = isAdmin && server ? missingBundledPosts(server) : [];
    return { posts, isAdmin, loading, reload, unpublished };
}

export function NewsList({ kind, posts, isAdmin, loading, unpublished, onOpen, onWrite, onUpload }: {
    kind: NewsKind;
    posts: NewsPost[];
    isAdmin: boolean;
    loading: boolean;
    unpublished: NewsPost[];
    onOpen: (post: NewsPost) => void;
    onWrite: () => void;
    onUpload: () => void;
}) {
    const items = posts.filter(post => post.kind === kind);
    return <div className="mt-4">
        {isAdmin && <div className="mb-3 flex flex-wrap gap-2">
            <button type="button" className={`${PRIMARY} flex items-center gap-1.5`} onClick={onWrite}><PenLine size={16} />글쓰기</button>
            {unpublished.length > 0 && <button type="button" className={`${SECONDARY} flex items-center gap-1.5`} onClick={onUpload}>
                <Upload size={16} />앱 기본 글 {unpublished.length}개 서버에 올리기
            </button>}
        </div>}
        {items.length === 0
            ? <p className="py-10 text-center text-sm text-slate-500">{loading ? '불러오는 중이에요.' : `아직 등록된 ${KIND_LABEL[kind]}이 없어요.`}</p>
            : <ul className={MENU_LIST}>
                {items.map(post => <li key={post.id}>
                    <button type="button" onClick={() => onOpen(post)}
                        className="flex w-full items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-amber-50">
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                                {post.pinned && <Pin size={14} className="shrink-0 text-amber-500" aria-label="상단 고정" />}
                                {!post.visible && <EyeOff size={14} className="shrink-0 text-slate-400" aria-label="비공개" />}
                                <span className="truncate text-sm font-medium text-slate-800">{post.title}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-400 tabular-nums">{formatPostDate(post.publishedAt)}</span>
                        </span>
                        <ChevronRight size={18} className={MENU_TRAILING} />
                    </button>
                </li>)}
            </ul>}
    </div>;
}

export function NewsDetail({ post, isAdmin, onEdit }: { post: NewsPost; isAdmin: boolean; onEdit: () => void }) {
    return <article className="mt-4">
        <h3 className="text-lg font-semibold leading-7 text-slate-900">{post.title}</h3>
        <p className="mt-1 text-xs text-slate-400 tabular-nums">
            {formatPostDate(post.publishedAt)}{!post.visible && ' · 비공개'}{post.pinned && ' · 상단 고정'}
        </p>
        <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            {toParagraphs(post.body).map((text, index) => <p key={index} className="whitespace-pre-line">{text}</p>)}
        </div>
        {isAdmin && <button type="button" className={`${SECONDARY} mt-6 flex items-center gap-1.5`} onClick={onEdit}><PenLine size={16} />수정</button>}
    </article>;
}

/** New post (no id) or edit of an existing one. Bundled posts keep their id, so saving puts them on the server. */
export function NewsEditor({ initial, onSaved, onCancel, onDeleted }: {
    initial: NewsDraft & { onServer: boolean };
    onSaved: (id: string) => void;
    onCancel: () => void;
    onDeleted: () => void;
}) {
    const [draft, setDraft] = useState<NewsDraft>(initial);
    const [date, setDate] = useState(toDateInput(initial.publishedAt));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const set = <K extends keyof NewsDraft>(key: K, value: NewsDraft[K]) => setDraft(current => ({ ...current, [key]: value }));

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!draft.title.trim() || !draft.body.trim()) {
            setError('제목과 본문을 입력해 주세요.');
            return;
        }
        // Keep the original time when the date was not changed; a new date starts at noon that day.
        const publishedAt = date === toDateInput(initial.publishedAt) ? initial.publishedAt : new Date(`${date}T12:00:00`).getTime();
        if (!Number.isFinite(publishedAt)) {
            setError('게시일을 확인해 주세요.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            onSaved(await saveNewsPost({ ...draft, publishedAt }));
        } catch {
            setError('저장하지 못했어요. 관리자 계정으로 로그인했는지, 인터넷이 연결되어 있는지 확인해 주세요.');
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!draft.id) return;
        setBusy(true);
        setError('');
        try {
            await deleteNewsPost(draft.id);
            onDeleted();
        } catch {
            setError('삭제하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
            setBusy(false);
        }
    };

    return <form className="mt-4 space-y-4" onSubmit={save}>
        <div>
            <span className={LABEL}>분류</span>
            <div className="flex gap-2" role="radiogroup" aria-label="분류">
                {(['notice', 'update'] as const).map(kind => <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind}
                    onClick={() => set('kind', kind)}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${draft.kind === kind ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {KIND_LABEL[kind]}
                </button>)}
            </div>
        </div>
        <div>
            <label htmlFor="news-title" className={LABEL}>제목</label>
            <input id="news-title" className={FIELD} value={draft.title} maxLength={NEWS_TITLE_MAX}
                onChange={event => set('title', event.target.value)} placeholder="예: 1.0.8 · 새 장식 추가" />
        </div>
        <div>
            <label htmlFor="news-body" className={LABEL}>본문 <span className="font-normal text-slate-400">· 빈 줄로 문단을 나눠요</span></label>
            <textarea id="news-body" className={`${FIELD} min-h-[12rem] resize-y leading-6`} value={draft.body} maxLength={NEWS_BODY_MAX}
                onChange={event => set('body', event.target.value)} />
            <p className="mt-1 text-right text-xs text-slate-400 tabular-nums">{draft.body.length.toLocaleString()} / {NEWS_BODY_MAX.toLocaleString()}</p>
        </div>
        <div>
            <label htmlFor="news-date" className={LABEL}>게시일</label>
            <input id="news-date" type="date" className={FIELD} value={date} onChange={event => setDate(event.target.value)} />
        </div>
        <div className="flex flex-col gap-2 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input id="news-visible" type="checkbox" className="h-4 w-4 accent-amber-500"
                checked={draft.visible} onChange={event => set('visible', event.target.checked)} />공개 <span className="text-xs text-slate-400">끄면 관리자에게만 보여요</span></label>
            <label className="flex items-center gap-2"><input id="news-pinned" type="checkbox" className="h-4 w-4 accent-amber-500"
                checked={draft.pinned} onChange={event => set('pinned', event.target.checked)} />상단 고정</label>
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
            <button type="submit" className={`${PRIMARY} flex-1`} disabled={busy}>{busy ? '저장하는 중…' : '저장'}</button>
            <button type="button" className={SECONDARY} disabled={busy} onClick={onCancel}>취소</button>
        </div>
        {initial.onServer && draft.id && <div className="border-t border-slate-100 pt-4">
            {confirmDelete
                ? <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex-1 text-slate-600">이 글을 삭제할까요? 되돌릴 수 없어요.</span>
                    <button type="button" className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60" disabled={busy} onClick={remove}>삭제</button>
                    <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirmDelete(false)}>그대로 두기</button>
                </div>
                : <button type="button" className="text-sm font-medium text-red-500 hover:text-red-600" onClick={() => setConfirmDelete(true)}>글 삭제</button>}
        </div>}
    </form>;
}

/** Puts the bundled posts on the server with their own ids, so they keep showing once the server has posts. */
export const uploadBundledPosts = async (posts: NewsPost[]) => {
    for (const post of posts) {
        await saveNewsPost({ id: post.id, kind: post.kind, title: post.title, body: post.body, publishedAt: post.publishedAt, visible: true, pinned: false });
    }
};
