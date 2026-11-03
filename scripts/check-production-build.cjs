// 배포 빌드(dist)에 로컬 미리보기(npm run dev:mock) 코드가 섞이지 않았는지 확인합니다.
// npm run build가 vite build 뒤에 이 스크립트를 실행합니다. 미리보기 문구가 하나라도 있으면 빌드를 실패시킵니다.
//
// 사용: node scripts/check-production-build.cjs [빌드 폴더, 기본 dist]
const fs = require('node:fs');
const path = require('node:path');

/**
 * 미리보기 화면에만 있는 문구. 배포 빌드에 하나라도 남아 있으면 미리보기 코드가 빠지지 않은 것입니다.
 * 각 문구가 실제 미리보기 소스에 있는지도 확인하므로(MARKER_SOURCES), 문구를 바꾸면 여기도 함께 고쳐야 합니다.
 */
const MOCK_MARKERS = [
    // 미리보기 모드 이름과 저장 칸, 기기 테두리 안 iframe 표시, 바깥 패널과 잇는 다리 이름
    'monetization-mock',
    'mock-screen',
    '__koiworldMonetizationMockBridge',
    // 휴대폰 화면 바깥의 배지와 도구 패널
    '미리보기 모드',
    '실제 청구 없음',
    '미리보기 도구',
    // 휴대폰 화면 안의 테스트 배너·전면 동영상 광고(가상의 앱 광고)
    'Sample App',
    '광고 건너뛰기',
    // Google Play 결제 시트의 테스트 결제 수단과 앱 아이콘 주소(개발 서버 전용)
    '테스트 카드, 항상 승인',
    '느린 테스트 카드',
    'mipmap-xxxhdpi/ic_launcher.png',
];

/** 문구가 들어 있어야 하는 미리보기 소스(빌드 검사가 빈 검사가 되지 않도록 확인합니다) */
const MARKER_SOURCES = [
    'config/monetizationMock.ts',
    'services/mockMonetization.ts',
    'services/mockPreviewBridge.ts',
    'components/mock/mockPreviewEnv.ts',
    'components/mock/MonetizationMockLayer.tsx',
    'components/mock/MockPreviewRoot.tsx',
    'components/mock/MockPreviewPanel.tsx',
    'components/mock/MockTestBanner.tsx',
    'components/mock/MockVideoAd.tsx',
    'components/mock/MockPlaySheet.tsx',
];

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map', '.txt', '.webmanifest']);

/** 빌드 도구가 한글을 \uXXXX로 바꿔 쓰는 경우도 찾습니다. */
const escapedForms = marker => {
    const lower = marker.replace(/[^\x20-\x7e]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return [...new Set([marker, lower, lower.replace(/\\u([0-9a-f]{4})/g, (_, hex) => `\\u${hex.toUpperCase()}`)])];
};

const listFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
});

/** 빌드 폴더에서 미리보기 문구가 들어 있는 파일을 찾습니다. */
const findMockMarkers = (buildDir, markers = MOCK_MARKERS) => {
    const found = [];
    for (const file of listFiles(buildDir)) {
        if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
        const content = fs.readFileSync(file, 'utf8');
        for (const marker of markers) {
            if (escapedForms(marker).some(form => content.includes(form))) {
                found.push({ file: path.relative(buildDir, file), marker });
            }
        }
    }
    return found;
};

/** 문구 목록이 실제 미리보기 소스와 맞는지 확인합니다. 없는 문구를 돌려줍니다. */
const markersMissingFromSources = (rootDir = path.join(__dirname, '..')) => {
    const source = MARKER_SOURCES.map(file => fs.readFileSync(path.join(rootDir, file), 'utf8')).join('\n');
    return MOCK_MARKERS.filter(marker => !source.includes(marker));
};

module.exports = { MOCK_MARKERS, findMockMarkers, markersMissingFromSources };

if (require.main === module) {
    const buildDir = path.resolve(process.argv[2] ?? path.join(__dirname, '..', 'dist'));
    if (!fs.existsSync(buildDir)) {
        console.error(`[미리보기 검사] 빌드 폴더가 없습니다: ${buildDir}`);
        process.exit(1);
    }
    const missing = markersMissingFromSources();
    if (missing.length > 0) {
        console.error(`[미리보기 검사] 미리보기 소스에 없는 문구가 목록에 있습니다: ${missing.join(', ')}`);
        process.exit(1);
    }
    const found = findMockMarkers(buildDir);
    if (found.length > 0) {
        console.error('[미리보기 검사] 배포 빌드에 로컬 미리보기 코드가 들어 있습니다.');
        for (const { file, marker } of found) console.error(`  ${file}: "${marker}"`);
        process.exit(1);
    }
    console.log(`[미리보기 검사] 통과: ${path.relative(process.cwd(), buildDir) || buildDir}에 미리보기 문구 ${MOCK_MARKERS.length}개가 없습니다.`);
}
