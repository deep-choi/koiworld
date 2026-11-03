// 테스트가 저장소 소스 글자를 직접 비교할 때 쓰는 도우미입니다.
// Windows에서 core.autocrlf=true로 받으면 파일 줄바꿈이 CRLF(\r\n)가 되고, 코드 정리 도구는 줄바꿈과 들여쓰기를 바꿀 수 있습니다.
// 그런 차이로 테스트가 깨지지 않도록, 줄바꿈을 \n으로 맞추고 코드 조각은 공백·줄바꿈·들여쓰기와 관계없이 찾습니다.
// (tests/*.cjs 바깥 폴더에 두어 node --test tests/*.cjs가 이 파일을 테스트로 실행하지 않습니다.)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** 줄바꿈을 \n 하나로 맞춥니다(CRLF, 옛 Mac의 CR 모두). */
const normalizeNewlines = text => text.replace(/\r\n?/g, '\n');

/** 저장소 기준 경로의 파일을 읽어 줄바꿈을 \n으로 맞춰 돌려줍니다. */
const readSource = file => normalizeNewlines(fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8'));

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 코드 조각을 찾는 정규식. 조각 안의 공백 자리는 줄바꿈·들여쓰기·공백 수와 관계없이 맞습니다.
 * 단어끼리 붙어 있으면 안 되는 자리(예: `const pondError`)에는 공백이 하나 이상 있어야 하고,
 * 기호 옆 공백(예: `( a`, `a ===`)은 없어도 맞습니다.
 */
const sourcePattern = snippet => {
    const parts = snippet.trim().split(/\s+/);
    let pattern = escapeRegExp(parts[0]);
    for (let i = 1; i < parts.length; i++) {
        const joinsWords = /\w$/.test(parts[i - 1]) && /^\w/.test(parts[i]);
        pattern += (joinsWords ? '\\s+' : '\\s*') + escapeRegExp(parts[i]);
    }
    return new RegExp(pattern);
};

module.exports = { normalizeNewlines, readSource, sourcePattern };
