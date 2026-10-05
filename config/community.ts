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

// 앱에 기본으로 들어 있는 소식입니다. 서버(Firestore news 컬렉션)에 글이 있으면 서버 글을 보여 주고,
// 서버에 연결할 수 없을 때만 이 목록을 보여 줍니다. 새 글은 앱의 관리자 글쓰기 화면에서 올립니다.
export const NEWS: Array<{ id: string; kind: 'notice' | 'update'; title: string; paragraphs: string[]; publishedAt: string }> = [
    {
        id: '1.0.6', kind: 'update', title: '1.0.6 · 새 형질과 다듬어진 잉어', publishedAt: '2026-10-05T21:00:00+09:00',
        paragraphs: [
            '교배로 새 형질 6가지가 나타납니다. 지느러미 뿌리가 무늬 색으로 물드는 모토구로, 은빛 비늘의 긴린, 지느러미가 길게 늘어지는 히레나가, 무늬 위에 비늘 그물이 덮이는 고로모, 정수리에 점 하나만 남는 탄초, 등줄기를 따라 육각 비늘이 붙는 도이츠를 찾아보세요.',
            '고로모, 탄초, 도이츠는 열성이라 유전자를 하나만 가진 보인자끼리 교배해야 모습이 드러납니다. 코이 정보 화면에서 가진 형질과 유전자 수를 확인할 수 있습니다.',
            '새 형질 업적 8종이 추가되었고, 형질이 나타난 코이는 더 높은 가격에 팔립니다.',
            '잉어의 머리, 주둥이, 눈, 가슴 모양을 다듬고 지느러미를 키웠습니다. 비늘은 한결 굵직해졌습니다.',
            '잉어를 그리는 방식을 최적화해 연못이 더 부드럽게 움직입니다.',
            '상점의 프리미엄 옥수수 설명을 실제 효과(일반 먹이의 2배)에 맞게 고쳤습니다.',
        ],
    },
    {
        id: '1.0.5', kind: 'update', title: '1.0.5 · 새로워진 잉어 디자인', publishedAt: '2026-10-05T09:00:00+09:00',
        paragraphs: [
            '잉어의 몸통, 지느러미, 꼬리, 무늬를 새롭게 다듬었습니다.',
            '헤엄치는 움직임이 한결 부드럽고 차분해졌습니다.',
        ],
    },
];
