import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase';
import { NEWS_BODY_MAX, NEWS_TITLE_MAX, sortPosts, type NewsKind, type NewsPost } from '../utils/newsPosts';

// Notices and updates live in the Firestore `news` collection. Everyone can read visible posts;
// accounts listed in `admins/{uid}` can read hidden ones and write (see firestore.rules).

const CACHE_KEY = 'koiworld:news-cache-v1';
const FETCH_TIMEOUT_MS = 8000;

const withTimeout = <T,>(promise: Promise<T>): Promise<T> => Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('news request timed out')), FETCH_TIMEOUT_MS)),
]);

const fromDocument = (id: string, data: Record<string, unknown>): NewsPost | null => {
    const publishedAt = data.publishedAt instanceof Timestamp ? data.publishedAt.toMillis() : null;
    if ((data.kind !== 'notice' && data.kind !== 'update') || typeof data.title !== 'string'
        || typeof data.body !== 'string' || publishedAt === null) return null;
    return {
        id,
        kind: data.kind,
        title: data.title,
        body: data.body,
        publishedAt,
        visible: data.visible === true,
        pinned: data.pinned === true,
    };
};

/** Posts saved on this device from the last successful load, or null. */
export const readCachedNews = (): NewsPost[] | null => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        const posts = raw ? JSON.parse(raw) : null;
        return Array.isArray(posts) ? posts : null;
    } catch {
        return null;
    }
};

const writeCachedNews = (posts: NewsPost[]) => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(posts.filter(post => post.visible)));
    } catch { /* storage full or unavailable: the next load fetches again */ }
};

/** Loads the posts from the server. Admins also get hidden posts. */
export const fetchNews = async (asAdmin: boolean): Promise<NewsPost[]> => {
    const posts = collection(db, 'news');
    const snapshot = await withTimeout(getDocs(asAdmin ? posts : query(posts, where('visible', '==', true))));
    const result = sortPosts(snapshot.docs
        .map(item => fromDocument(item.id, item.data()))
        .filter((post): post is NewsPost => post !== null));
    writeCachedNews(result);
    return result;
};

/** Calls back with whether the signed-in account is an admin, now and whenever the account changes. */
export const watchIsAdmin = (callback: (isAdmin: boolean) => void): (() => void) =>
    onAuthStateChanged(auth, async user => {
        if (!user || user.isAnonymous) {
            callback(false);
            return;
        }
        try {
            callback((await withTimeout(getDoc(doc(db, 'admins', user.uid)))).exists());
        } catch {
            callback(false);
        }
    });

export interface NewsDraft {
    id?: string;           // missing for a new post
    kind: NewsKind;
    title: string;
    body: string;
    publishedAt: number;
    visible: boolean;
    pinned: boolean;
}

/** Creates or replaces a post and returns its id. */
export const saveNewsPost = async (draft: NewsDraft): Promise<string> => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    const reference = draft.id ? doc(db, 'news', draft.id) : doc(collection(db, 'news'));
    await withTimeout(setDoc(reference, {
        kind: draft.kind,
        title: draft.title.trim().slice(0, NEWS_TITLE_MAX),
        body: draft.body.trim().slice(0, NEWS_BODY_MAX),
        publishedAt: Timestamp.fromMillis(draft.publishedAt),
        visible: draft.visible,
        pinned: draft.pinned,
        updatedAt: serverTimestamp(),
        authorUid: uid,
    }));
    return reference.id;
};

export const deleteNewsPost = async (id: string): Promise<void> => {
    await withTimeout(deleteDoc(doc(db, 'news', id)));
};
