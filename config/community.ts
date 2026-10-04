export const COMMUNITY_LINKS = {
    discord: import.meta.env.VITE_DISCORD_URL || 'https://discord.gg/QRWusRP6',
    cafe: import.meta.env.VITE_NAVER_CAFE_URL || 'https://cafe.naver.com/koiworld',
};

export function communityUrl(value: string): string | null {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.href : null;
    } catch { return null; }
}

// 새 소식은 이 목록에 최신순으로 추가합니다. 서비스에 게시할 내용만 작성합니다.
export const NEWS: Array<{ id: string; kind: 'notice' | 'update'; title: string; paragraphs: string[] }> = [
    {
        id: '1.0.5', kind: 'update', title: '1.0.5 · 새로워진 잉어 디자인',
        paragraphs: [
            '잉어의 몸통, 지느러미, 꼬리, 무늬를 새롭게 다듬었습니다.',
            '헤엄치는 움직임이 한결 부드럽고 차분해졌습니다.',
        ],
    },
];
