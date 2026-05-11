"use strict";
/**
 * Zen Koi Garden - Cloud Functions
 *
 * 5개 핵심 함수:
 * 1. onSessionCreate - 동시접속 방지
 * 2. onBidCreate - 입찰 검증 및 AP 처리
 * 3. processExpiredAuctions - 만료 경매 처리 (스케줄)
 * 4. onBuyNow - 즉시 구매
 * 5. rewardAdPoints - 광고 보상
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetGameData = exports.onCancelListing = exports.rewardAdPoints = exports.onBuyNow = exports.processExpiredAuctions = exports.onBidCreate = exports.onSessionCreate = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
// Firebase Admin 초기화
admin.initializeApp();
const db = admin.firestore();
// ============================================
// 🔒 비용 보호 설정
// ============================================
// - maxInstances: 10 → cold start 및 503 오류 방지
// - memory: 256MB → 최소 메모리 (기본 512MB보다 저렴)
// - timeoutSeconds: 30 → 30초 제한 (무한 실행 방지)
// - 일일 호출 제한: 1000회 (무료 할당량 내)
(0, firebase_functions_1.setGlobalOptions)({
    maxInstances: 10,
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 30,
});
// ============================================
// CORS 설정 (명시적 도메인 허용)
// ============================================
const CORS_OPTIONS = [
    "https://koi-garden-abcf5.web.app",
    "https://koi-garden-abcf5.firebaseapp.com",
    "https://koigarden.shop",
    "https://www.koigarden.shop",
    "http://localhost:5173",
    "http://localhost:4000",
];
// ============================================
// 상수 정의
// ============================================
const TRANSACTION_FEE_RATE = 0.05; // 5% 수수료
const AD_REWARDS = {
    "15s": 200,
    "30s": 500,
};
// 일일 호출 제한 (비용 보호)
const DAILY_CALL_LIMIT = 1000; // 하루 최대 1000회 호출
const RATE_LIMIT_COLLECTION = "rateLimits";
// ============================================
// 🔒 Rate Limiting 헬퍼 (비용 보호)
// ============================================
async function checkRateLimit(functionName) {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const docId = `${functionName}_${today}`;
    const rateLimitRef = db.collection(RATE_LIMIT_COLLECTION).doc(docId);
    try {
        const result = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(rateLimitRef);
            if (!doc.exists) {
                transaction.set(rateLimitRef, { count: 1, date: today });
                return true;
            }
            const data = doc.data();
            const currentCount = (data === null || data === void 0 ? void 0 : data.count) || 0;
            if (currentCount >= DAILY_CALL_LIMIT) {
                logger.warn(`Rate limit exceeded for ${functionName}: ${currentCount}/${DAILY_CALL_LIMIT}`);
                return false; // 제한 초과
            }
            transaction.update(rateLimitRef, {
                count: admin.firestore.FieldValue.increment(1),
            });
            return true;
        });
        return result;
    }
    catch (error) {
        logger.error("Rate limit check failed:", error);
        return true; // 에러 시 허용 (서비스 중단 방지)
    }
}
// ============================================
// 1. 동시접속 방지 - 새 세션 생성 시 처리
// ============================================
exports.onSessionCreate = (0, firestore_1.onDocumentWritten)("sessions/{userId}", async (event) => {
    var _a;
    const userId = event.params.userId;
    const snapshot = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after;
    if (!snapshot || !snapshot.exists) {
        return;
    }
    const newSession = snapshot.data();
    if (!newSession.deviceId) {
        return;
    }
    // 클라이언트가 세션 문서를 읽을 수 없더라도(/sessions read 차단),
    // 사용자 문서(/users/{uid})에 activeDeviceId를 기록해 중복 로그인 감지가 가능하게 합니다.
    await db.doc(`users/${userId}`).set({
        activeDeviceId: newSession.deviceId,
        sessionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
});
// ============================================
// 2. 입찰 생성 시 검증 및 처리
// ============================================
exports.onBidCreate = (0, firestore_1.onDocumentCreated)("marketplace/listings/items/{listingId}/bids/{bidId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        logger.warn("No data in bid create event");
        return;
    }
    const { listingId } = event.params;
    const bidData = snapshot.data();
    try {
        // 트랜잭션으로 처리
        await db.runTransaction(async (transaction) => {
            // 경매 정보 가져오기
            const listingRef = db.doc(`marketplace/listings/items/${listingId}`);
            const listingSnap = await transaction.get(listingRef);
            if (!listingSnap.exists) {
                throw new Error("Listing not found");
            }
            const listing = listingSnap.data();
            // 검증: 경매가 활성 상태인지
            if (listing.status !== "active") {
                throw new Error("Auction is not active");
            }
            // 검증: 입찰가가 현재가보다 높은지
            if (bidData.amount <= listing.currentBid) {
                throw new Error("Bid must be higher than current bid");
            }
            // 검증: 본인 경매에 입찰하지 않았는지
            if (bidData.bidderId === listing.sellerId) {
                throw new Error("Cannot bid on your own listing");
            }
            // 입찰자 AP 확인
            const bidderRef = db.doc(`users/${bidData.bidderId}`);
            const bidderSnap = await transaction.get(bidderRef);
            if (!bidderSnap.exists) {
                throw new Error("Bidder not found");
            }
            const bidder = bidderSnap.data();
            const bidderAp = typeof bidder.ap === "number" ? bidder.ap : 0;
            // 수수료 포함 금액
            const bidWithFee = Math.ceil(bidData.amount * (1 + TRANSACTION_FEE_RATE));
            if (bidderAp < bidWithFee) {
                throw new Error("Insufficient AP");
            }
            // 이전 최고 입찰자에게 AP 반환 (있는 경우)
            if (listing.currentBidderId && listing.currentBidderId !== bidData.bidderId) {
                const prevBidderRef = db.doc(`users/${listing.currentBidderId}`);
                const prevBidWithFee = Math.ceil(listing.currentBid * (1 + TRANSACTION_FEE_RATE));
                transaction.update(prevBidderRef, {
                    ap: admin.firestore.FieldValue.increment(prevBidWithFee),
                });
                logger.info(`Refunded ${prevBidWithFee} AP to previous bidder: ${listing.currentBidderId}`);
            }
            // 새 입찰자 AP 차감
            transaction.update(bidderRef, {
                ap: admin.firestore.FieldValue.increment(-bidWithFee),
            });
            // 경매 정보 업데이트
            transaction.update(listingRef, {
                currentBid: bidData.amount,
                currentBidderId: bidData.bidderId,
                currentBidderNickname: bidData.bidderNickname,
                bidCount: admin.firestore.FieldValue.increment(1),
            });
            logger.info(`Bid placed on listing ${listingId}`, {
                amount: bidData.amount,
                bidderId: bidData.bidderId,
            });
        });
    }
    catch (error) {
        logger.error("Error processing bid:", error);
        // 입찰 문서 삭제 (실패한 입찰)
        await snapshot.ref.delete();
        throw error;
    }
});
// ============================================
// 3. 만료 경매 처리 (1분마다 실행)
// ============================================
exports.processExpiredAuctions = (0, scheduler_1.onSchedule)({
    schedule: "every 1 minutes",
    timeZone: "Asia/Seoul",
}, async () => {
    const now = admin.firestore.Timestamp.now();
    try {
        // 만료된 활성 경매 찾기
        const expiredListings = await db
            .collection("marketplace/listings/items")
            .where("status", "==", "active")
            .where("expiresAt", "<=", now)
            .get();
        if (expiredListings.empty) {
            logger.info("No expired auctions to process");
            return;
        }
        logger.info(`Processing ${expiredListings.size} expired auctions`);
        // 각 만료 경매 처리
        for (const doc of expiredListings.docs) {
            const listing = doc.data();
            try {
                await db.runTransaction(async (transaction) => {
                    if (listing.currentBidderId) {
                        // 낙찰 처리
                        const buyerRef = db.doc(`users/${listing.currentBidderId}`);
                        const sellerRef = db.doc(`users/${listing.sellerId}`);
                        // 판매자에게 AP 지급 (수수료 제외 - 이미 구매자가 지불함)
                        transaction.update(sellerRef, {
                            ap: admin.firestore.FieldValue.increment(listing.currentBid),
                        });
                        // 구매자에게 잉어 추가
                        transaction.set(buyerRef, {
                            kois: admin.firestore.FieldValue.arrayUnion(listing.koiData),
                        }, { merge: true });
                        // 경매 상태 업데이트
                        transaction.update(doc.ref, { status: "sold" });
                        // 거래 기록 생성
                        const transactionRef = db.collection("transactions").doc();
                        const fee = Math.ceil(listing.currentBid * TRANSACTION_FEE_RATE);
                        transaction.set(transactionRef, {
                            type: "bid_win",
                            userId: listing.currentBidderId,
                            amount: -(listing.currentBid + fee),
                            fee: fee,
                            listingId: doc.id,
                            description: `경매 낙찰: ${listing.koiPreview}`,
                            timestamp: now,
                        });
                        logger.info(`Auction ${doc.id} sold to ${listing.currentBidderId} for ${listing.currentBid} AP`);
                    }
                    else {
                        // 유찰 처리 - 잉어 반환
                        const sellerRef = db.doc(`users/${listing.sellerId}`);
                        transaction.set(sellerRef, {
                            kois: admin.firestore.FieldValue.arrayUnion(listing.koiData),
                        }, { merge: true });
                        // 경매 상태 업데이트
                        transaction.update(doc.ref, { status: "expired" });
                        logger.info(`Auction ${doc.id} expired with no bids, koi returned to seller`);
                    }
                });
            }
            catch (innerError) {
                logger.error(`Error processing auction ${doc.id}:`, innerError);
            }
        }
    }
    catch (error) {
        logger.error("Error in processExpiredAuctions:", error);
        throw error;
    }
});
// ============================================
// 4. 즉시 구매
// ============================================
exports.onBuyNow = (0, https_1.onCall)({ cors: CORS_OPTIONS }, async (request) => {
    // 인증 확인
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    // 🔒 Rate limit 체크
    if (!await checkRateLimit("onBuyNow")) {
        throw new https_1.HttpsError("resource-exhausted", "Daily limit exceeded. Try again tomorrow.");
    }
    const buyerId = request.auth.uid;
    const { listingId } = request.data;
    if (!listingId) {
        throw new https_1.HttpsError("invalid-argument", "listingId is required");
    }
    try {
        const result = await db.runTransaction(async (transaction) => {
            // 경매 정보 가져오기
            const listingRef = db.doc(`marketplace/listings/items/${listingId}`);
            const listingSnap = await transaction.get(listingRef);
            if (!listingSnap.exists) {
                throw new https_1.HttpsError("not-found", "Listing not found");
            }
            const listing = listingSnap.data();
            // 검증
            if (listing.status !== "active") {
                throw new https_1.HttpsError("failed-precondition", "Auction is not active");
            }
            if (!listing.buyNowPrice) {
                throw new https_1.HttpsError("failed-precondition", "Buy now not available");
            }
            if (buyerId === listing.sellerId) {
                throw new https_1.HttpsError("failed-precondition", "Cannot buy your own listing");
            }
            // 구매자 정보
            const buyerRef = db.doc(`users/${buyerId}`);
            const buyerSnap = await transaction.get(buyerRef);
            if (!buyerSnap.exists) {
                throw new https_1.HttpsError("not-found", "Buyer not found");
            }
            const buyer = buyerSnap.data();
            const buyerAp = typeof buyer.ap === "number" ? buyer.ap : 0;
            // 수수료 계산
            const fee = Math.ceil(listing.buyNowPrice * TRANSACTION_FEE_RATE);
            const totalPrice = listing.buyNowPrice + fee;
            if (buyerAp < totalPrice) {
                throw new https_1.HttpsError("failed-precondition", "Insufficient AP");
            }
            // 이전 최고 입찰자 AP 반환 (있는 경우)
            if (listing.currentBidderId) {
                const prevBidderRef = db.doc(`users/${listing.currentBidderId}`);
                const prevBidWithFee = Math.ceil(listing.currentBid * (1 + TRANSACTION_FEE_RATE));
                transaction.update(prevBidderRef, {
                    ap: admin.firestore.FieldValue.increment(prevBidWithFee),
                });
            }
            // 구매자 AP 차감 및 잉어 추가 (문서가 없어도 동작하도록 set 사용)
            transaction.set(buyerRef, {
                ap: admin.firestore.FieldValue.increment(-totalPrice),
                kois: admin.firestore.FieldValue.arrayUnion(listing.koiData),
            }, { merge: true });
            // 판매자에게 AP 지급 (문서가 없어도 동작하도록 set 사용)
            const sellerRef = db.doc(`users/${listing.sellerId}`);
            transaction.set(sellerRef, {
                ap: admin.firestore.FieldValue.increment(listing.buyNowPrice),
            }, { merge: true });
            // 경매 상태 업데이트
            transaction.update(listingRef, { status: "sold" });
            // 거래 기록
            const transactionRef = db.collection("transactions").doc();
            transaction.set(transactionRef, {
                type: "purchase",
                userId: buyerId,
                amount: -totalPrice,
                fee: fee,
                listingId: listingId,
                description: "즉시 구매",
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
            return {
                success: true,
                message: "Purchase successful",
                koiData: listing.koiData,
                totalPaid: totalPrice,
                fee: fee,
            };
        });
        logger.info(`Buy now completed: listing ${listingId} by ${buyerId}`);
        return result;
    }
    catch (error) {
        logger.error("Error in onBuyNow:", error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Purchase failed");
    }
});
// ============================================
// 5. 광고 보상 (서버 검증)
// ============================================
exports.rewardAdPoints = (0, https_1.onCall)({ cors: CORS_OPTIONS }, async (request) => {
    // 인증 확인
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    // 🔒 Rate limit 체크
    if (!await checkRateLimit("rewardAdPoints")) {
        throw new https_1.HttpsError("resource-exhausted", "Daily limit exceeded. Try again tomorrow.");
    }
    const userId = request.auth.uid;
    const { adType, verificationToken } = request.data;
    // 입력 검증
    if (!adType || !["15s", "30s"].includes(adType)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid ad type");
    }
    if (!verificationToken) {
        throw new https_1.HttpsError("invalid-argument", "Verification token required");
    }
    // TODO: 실제 광고 네트워크 API로 토큰 검증
    // 현재는 기본 검증만 수행
    const isValidToken = verificationToken.length > 10;
    if (!isValidToken) {
        throw new https_1.HttpsError("failed-precondition", "Invalid verification token");
    }
    const rewardAmount = AD_REWARDS[adType];
    try {
        const result = await db.runTransaction(async (transaction) => {
            var _a, _b;
            const userRef = db.doc(`users/${userId}`);
            const userSnap = await transaction.get(userRef);
            const currentAp = userSnap.exists ? ((_b = (_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.ap) !== null && _b !== void 0 ? _b : 0) : 0;
            const newBalance = (typeof currentAp === "number" ? currentAp : 0) + rewardAmount;
            transaction.set(userRef, {
                ap: newBalance,
            }, { merge: true });
            // 거래 기록
            const transactionRef = db.collection("transactions").doc();
            transaction.set(transactionRef, {
                type: "ad_reward",
                userId: userId,
                amount: rewardAmount,
                description: `${adType} 광고 시청 보상`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
            return {
                success: true,
                message: `${rewardAmount} AP rewarded`,
                pointsAwarded: rewardAmount,
                newBalance: newBalance,
            };
        });
        logger.info(`Ad reward: ${rewardAmount} AP to ${userId}`);
        return result;
    }
    catch (error) {
        logger.error("Error in rewardAdPoints:", error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Reward failed");
    }
});
// ============================================
// 6. 판매 취소 (즉구/경매 공통)
// ============================================
exports.onCancelListing = (0, https_1.onCall)({ cors: CORS_OPTIONS }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    if (!await checkRateLimit("onCancelListing")) {
        throw new https_1.HttpsError("resource-exhausted", "Daily limit exceeded. Try again tomorrow.");
    }
    const userId = request.auth.uid;
    const { listingId } = request.data;
    if (!listingId) {
        throw new https_1.HttpsError("invalid-argument", "listingId is required");
    }
    try {
        const result = await db.runTransaction(async (transaction) => {
            const listingRef = db.doc(`marketplace/listings/items/${listingId}`);
            const listingSnap = await transaction.get(listingRef);
            if (!listingSnap.exists) {
                throw new https_1.HttpsError("not-found", "Listing not found");
            }
            const listing = listingSnap.data();
            if (listing.sellerId !== userId) {
                throw new https_1.HttpsError("permission-denied", "Not your listing");
            }
            if (listing.status !== "active") {
                throw new https_1.HttpsError("failed-precondition", "Listing is not active");
            }
            if (listing.currentBidderId) {
                throw new https_1.HttpsError("failed-precondition", "Cannot cancel after bids");
            }
            transaction.update(listingRef, {
                status: "cancelled",
            });
            // 잉어를 판매자의 수령 가능 목록(kois 배열)으로 반환
            const sellerRef = db.doc(`users/${userId}`);
            transaction.set(sellerRef, {
                kois: admin.firestore.FieldValue.arrayUnion(listing.koiData),
            }, { merge: true });
            return { success: true };
        });
        return result;
    }
    catch (error) {
        logger.error("Error in onCancelListing:", error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Cancel failed");
    }
});
// ============================================
// 7. 새 게임 시작(계정 데이터 초기화)
// ============================================
const NEW_GAME_DAILY_LIMIT = 3;
exports.resetGameData = (0, https_1.onCall)({ cors: CORS_OPTIONS }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    if (!await checkRateLimit("resetGameData")) {
        throw new https_1.HttpsError("resource-exhausted", "Daily limit exceeded. Try again tomorrow.");
    }
    const userId = request.auth.uid;
    // 판매 중인 코이가 있으면 새 게임(데이터 초기화)을 막습니다.
    const activeListingSnapshot = await db
        .collection("marketplace")
        .doc("listings")
        .collection("items")
        .where("sellerId", "==", userId)
        .where("status", "==", "active")
        .limit(1)
        .get();
    if (!activeListingSnapshot.empty) {
        throw new https_1.HttpsError("failed-precondition", "You have active marketplace listings. Cancel all listings before starting a new game.", { hasActiveListings: true });
    }
    // 서버 시간(UTC) 기준 날짜 키
    const dayKey = new Date().toISOString().split("T")[0];
    const userRef = db.doc(`users/${userId}`);
    let remainingResets = 0;
    await db.runTransaction(async (transaction) => {
        var _a;
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.exists ? userSnap.data() : {};
        const resetInfo = ((_a = userData === null || userData === void 0 ? void 0 : userData.newGameReset) !== null && _a !== void 0 ? _a : {});
        const currentCount = typeof resetInfo.count === "number" ? resetInfo.count : 0;
        const countForToday = resetInfo.dayKey === dayKey ? currentCount : 0;
        if (countForToday >= NEW_GAME_DAILY_LIMIT) {
            throw new https_1.HttpsError("resource-exhausted", "New game daily limit exceeded. Try again tomorrow.");
        }
        const nextCount = countForToday + 1;
        remainingResets = NEW_GAME_DAILY_LIMIT - nextCount;
        transaction.set(userRef, {
            gameData: admin.firestore.FieldValue.delete(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            newGameReset: {
                dayKey,
                count: nextCount,
                lastResetAt: admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
    });
    return {
        success: true,
        dayKey,
        remainingResets,
    };
});
//# sourceMappingURL=index.js.map