// Message Fold (Persistent) + Long Press Menu
// 메시지 객체의 extra.folded 값(true/없음)으로 접힘 상태를 저장합니다.
// is_system 처럼 chat.jsonl 에 함께 저장되므로 기기/브라우저가 달라도 유지됩니다.
//
// 동작:
//  - 접힌(저장된) 메시지의 바를 누르면 "임시로" 펼쳐집니다. (저장 상태는 변하지 않음)
//  - 펼쳐진 메시지 안을 누르면 그대로 유지, 다른 메시지/빈 곳을 누르면 다시 접힙니다.
//  - 저장된 접힘 상태는 메시지 액션의 아이콘(접기 설정 ↔ 접기 해제)으로 바뀝니다.
//  - 메시지(접힌 바 포함)를 길게 누르면 팝업이 뜨고 Hide(Unhide) / Delete / Fold(Unfold) / Cancel 을 고를 수 있습니다.
//  - 글자를 드래그로 선택한 뒤, 손을 떼고 선택된 글자 위를 다시 길게 누르면
//    Edit selection / Delete selection 팝업이 뜹니다. (모바일: 선택 후 뜨는 복사/모두 선택 툴바 상태에서 선택된 글자를 더 길게 누르기)
//  - Edit selection 에서 같은 글자가 여러 개면 "모두 바꾸기" 체크박스로 한 번에 교체할 수 있습니다.
//  - 선택한 글자가 저장된 텍스트에 그대로 없으면(마크다운/XML/정규식 등으로 화면이 달라진 경우)
//    SillyTavern 본체의 messageFormatting 으로 <p> 문단을 맞춰서 해당 문단을 통째로 편집합니다. (실패하면 메시지 통째 편집)
//  - 번역문(extra.display_text)이 있는 메시지는 Edit translation(번역문만 수정, 원문 mes 는 안 바뀜) /
//    Edit original(원문을 <p> 문단 단위로만 매칭해서 수정) 중에 고를 수 있습니다.
//  - LLM 번역 확장 번역문이 감지되면(원문과 번갈아 보이든 번역문만 보이든) 안내 토스트를 띄우고 번역문(display_text)만 수정합니다.
//    번역 확장의 IndexedDB(LLMtranslatorDB) 번역문을 직접 고친 뒤 /LlmTranslateID 로 화면용 display_text 를 다시 만들게 합니다(LLM 호출 없음).
//    DB 에서 못 찾으면 display_text 안의 번역 span 만 고치는 방식으로 폴백합니다. 원문(mes)은 건드리지 않습니다.
//    (변경) LLM 번역이 떠 있을 때 Edit 를 고르면 오류 토스트를 띄우고, LLM 번역 확장 자체의 "번역문 수정" 버튼(.mes_edit_translation)을 눌러
//    그 확장의 수정창으로 넘깁니다. Delete 는 위의 방식 그대로 동작합니다.
//  - 빨간 테두리 피드백은 터치(모바일)에서만 나타납니다.
//  - /fold, /unfold 슬래시 명령어 (/hide 처럼 인덱스 또는 범위: /fold 3, /fold 2-5, /fold 4-)
//  - 확장 패널 옵션
//      · 길게 누르기 메시지 메뉴 / 선택 글자 편집·삭제 메뉴 각각 on/off, 누르는 시간(마우스/터치) 조절
//        (선택 글자 메뉴는 마우스/터치 각각 별도의 누르는 시간 설정을 가짐, 최소 200ms)
//      · 자동 접기/숨기기 대상 선택: 슬래시 명령어 메시지만 / 유저가 아닌 모든 메시지
//      · 안 읽은 접힘 바 색 덧입힘 on/off (기본 on)
//      · 펼친 메시지 닫는 방법: 다른 곳 클릭 / 그 메시지 더블클릭(더블탭)
//      · Hide & Fold 연동: hide 하면 자동 fold, unhide 하면 자동 unfold (팝업 버튼도 하나로 합쳐짐)
//      · 슬래시 명령어로 만든 메시지(/sendas, /comment 등, extra.model='slash command') 자동 접기 (아직 안 눌렀으면 인용문 색을 20% 덧입힘)

import { chat, eventSource, event_types, saveChatConditional, updateMessageBlock } from '../../../../script.js';

const KEY = 'folded';
const UNSEEN_KEY = 'mf_unseen';   // 자동 접힘 후 아직 바를 클릭하지 않은 상태 (색 덧입힘용). 바를 누르면 삭제됨
const AUTO_HIDE_KEY = 'mf_auto_hide'; // 자동 숨기기를 이미 처리한 메시지 (직접 unhide 한 뒤 다시 숨겨지는 것 방지)
const AUTO_KEY = 'mf_auto';       // 자동 접기를 이미 한 번 처리한 메시지 (수동으로 펼친 뒤 다시 접히는 것 방지)
const COMMENT_TYPE = 'comment';   // /comment 등으로 만든 메시지의 extra.type 값

// 미확인(자동 접힘 후 아직 안 눌러본) 바의 인용문 색 덧입힘은 style.css 의 .mf-unseen 규칙에서 처리

// ===== 확장 설정 (확장 패널) =====
const MODULE = 'message_fold_ext';
const DEFAULTS = {
    linkHideFold: false,
    linkMode: 'replace',
    autoFoldComments: false,
    autoHideComments: false,
    autoScope: 'none',      // 자동 접기/숨기기 대상: 'none'(사용 안 함) | 'comment'(슬래시 명령어 메시지만) | 'all'(유저가 아닌 모든 메시지) | 'every'(유저 메시지 포함 전부)
    tintUnseen: true,       // 자동 접힘 후 안 읽은 바에 색 덧입힘
    closeMode: 'outside',   // 펼친 메시지 닫는 방법: 'outside'(다른 곳 클릭) | 'dblclick'(그 메시지 더블클릭/더블탭)
    longPressMenu: true,    // 메시지 길게 누르기 팝업 (Delete / Hide / Fold) 사용
    selectionMenu: true,    // 글자 선택 후 길게 누르기 팝업 (Edit / Delete selection) 사용
    holdMouse: 610,         // 마우스 길게 누르기 시간(ms)
    holdTouch: 750,         // 터치(모바일) 길게 누르기 시간(ms)
    holdSelTouch: 600,      // 선택한 글자 위 길게 누르기 시간 - 터치(ms)
    holdSelMouse: 300,      // 선택한 글자 위 길게? 누르기 시간 - 마우스(ms)
    holdSaved: null,        // 터치랑 마우스 저장
    holdSelSaved: null,     // 텍스트 선택 (터치 + 마우스) 저장
};

function settings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    for (const [k, v] of Object.entries(DEFAULTS)) extensionSettings[MODULE][k] ??= v;
    const st = extensionSettings[MODULE];
    // 대상이 'none' 이면 자동 접기/숨기기는 항상 꺼진 상태로 유지
    if (st.autoScope === 'none') {
        st.autoFoldComments = false;
        st.autoHideComments = false;
    }
    return st;
}

// Hide & Fold 연동 모드: null(끔) | 'keep'(Fold 버튼 유지) | 'replace'(Fold 버튼을 Hide 에 합침)
function linkMode() {
    const st = settings();
    if (!st.linkHideFold) return null;
    return st.linkMode === 'keep' ? 'keep' : 'replace';
}

const isComment = (msg) => msg?.extra?.type === COMMENT_TYPE;

// 슬래시 명령어로 만들어진 메시지 (/sendas, /comment, /sys 등): extra.model 이 'slash command'
// 일반 생성 메시지는 extra.model 에 실제 모델명이 들어가고, 유저 메시지는 제외
const SLASH_MODEL = 'slash command';
const isSlashMade = (msg) => !!msg && !msg.is_user && !!msg.extra
    && (msg.extra.model === SLASH_MODEL || isComment(msg));

// 자동 접기/숨기기 대상: 설정에 따라 슬래시 명령어 메시지만 / 유저가 아닌 모든 메시지
// 이미 있던 메시지는 건드리지 않고, 채팅을 연 시점 이후(id >= autoBaseline)에 생성된 메시지만 대상으로 함
let autoBaseline = Infinity;
const syncBaseline = () => { autoBaseline = chat.length; };
const isAutoTarget = (msg, id) => {
    if (!msg || id < autoBaseline) return false;
    switch (settings().autoScope) {
        case 'every': return true;             // 유저 메시지 포함 전부
        case 'all': return !msg.is_user;       // 유저가 아닌 모든 메시지
        case 'comment': return isSlashMade(msg); // 슬래시 명령어 메시지만
        default: return false;                 // 'none'
    }
};

// 상태에 따라 번갈아 나오는 두 개의 버튼 (message hide/unhide 처럼 서로 다른 버튼이 같은 자리에서 교체)
//  - .mes_fold   : 아직 접기 설정이 안 된 상태에서 보임 → 누르면 접기 설정
//  - .mes_unfold : 접기 설정된 상태에서 보임        → 누르면 접기 해제
const ICON_SET = 'fa-compress';
const ICON_UNSET = 'fa-expand';
const TITLE_SET = 'Fold message';
const TITLE_UNSET = 'Unfold message';
const FOLD_BTN_SELECTOR = '.mes_fold, .mes_unfold';

// ===== 길게 누르기 설정 =====
// 메시지 길게 누르기 시간은 확장 패널(settings().holdMouse / holdTouch)에서,
// 선택한 글자 위 길게 누르기 시간은 settings().holdSelTouch(터치) / settings().holdSelMouse(마우스) 로 따로 조절.
// 선택 메뉴는 시스템 기본 드래그(안드로이드 등)보다 먼저 떠야 해서 최소값을 더 낮게 허용
const HOLD_MIN = 500;
const SEL_HOLD_MIN = 200;
const HOLD_MAX = 1000;
const holdTime = (v, fallback, min = HOLD_MIN) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(HOLD_MAX, Math.max(min, n)) : fallback;
};
const VISUAL_MS = 300;      // 팝업 직전 이 시간 동안 테두리가 서서히 진해짐
const AFTER_POPUP_MS = 80; // 팝업이 뜬 뒤에도 테두리를 유지하는 시간
const MOVE_TOLERANCE = 10;  // px
const LP_IGNORE = 'a, button, input, textarea, select, .mes_buttons, .mes_edit_buttons, .swipe_left, .swipe_right, .swipes-counter, .extraMesButtons, .mes_img_container, .mes_reasoning_details, [contenteditable="true"], .mes_text img, .mes_text video, .mes_text audio, .mes_text canvas';

// true: 터치 기기에서 본문(.mes_text)을 길게 누르면 팝업 대신 텍스트 선택이 동작
//       (이름/아바타/여백/접힌 바 에서만 길게 누르기 작동)
// false: 본문 포함 어디서든 길게 누르기 작동 (단, 선택이 시작되면 취소)
const TOUCH_TEXT_SELECTABLE = true;

// 글자 주변으로 이 값(px)만큼은 "글자 위"로 간주 (그 밖의 본문 여백은 길게 누르기 허용)
// 가로는 타이트하게(글자 오른쪽 빈 공간을 여백으로 인식), 세로는 줄 사이 틈을 글자로 취급
const TEXT_HIT_PAD_X = 3;
const TEXT_HIT_PAD_Y = 5;

// 바깥 클릭으로 간주하지 않을 영역 (상단바, 하단 입력창, 팝업 등)
const IGNORE_SELECTOR = [
    '#top-bar',
    '#form_sheld',
    '.drawer-content',
    '.popup',
    'dialog',
    '#toast-container',
    '.select2-container',
    '.select2-dropdown',
].join(', ');

// 현재 임시로 펼쳐져 있는 메시지 id (없으면 null)
let openId = null;

const isFolded = (id) => !!chat[id]?.extra?.[KEY];

function makePreview(id) {
    const msg = chat[id];
    const raw = String(msg?.mes ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[*_`#>~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const snippet = raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
    return { name: msg?.name ?? '', snippet };
}

// 접힌 바 안의 내용(아이콘 / 이름 / 미리보기)을 만든다.
// 모양은 전부 style.css 가 정하므로 여기서는 DOM 만 만들고, 내용이 실제로 바뀐 경우에만 다시 만든다.
// (펼침/접힘 전환 때는 .mf-folded 클래스만 바뀌고 바는 그대로 재사용됨)
function ensureBar(ph, id) {
    const msg = chat[id];
    // 숨김(hide) 처리된 메시지(is_system, comment 포함)는 유령 아이콘, 숨김 해제된 comment 는 말풍선, 그 외는 ▶
    const kind = msg?.is_system ? 'hidden' : (isComment(msg) ? 'comment' : 'normal');
    const sig = ph._mfSig;
    if (sig && sig.mes === msg?.mes && sig.name === msg?.name && sig.kind === kind) return;
    ph._mfSig = { mes: msg?.mes, name: msg?.name, kind };

    const { name, snippet } = makePreview(id);
    let arrow;
    if (kind === 'hidden') {
        arrow = document.createElement('i');
        arrow.className = 'fa-solid fa-ghost';
        arrow.title = 'Hidden message';
    } else if (kind === 'comment') {
        arrow = document.createElement('i');
        arrow.className = 'fa-solid fa-comment-dots';
        arrow.title = 'Comment';
    } else {
        arrow = document.createElement('span');
        arrow.textContent = '▶';
    }
    arrow.classList.add('mf-ph-icon');
    const nm = document.createElement('b');
    nm.className = 'mf-ph-name';
    nm.textContent = name;
    const tx = document.createElement('span');
    tx.className = 'mf-ph-text';
    tx.textContent = snippet ? `— ${snippet}` : '';
    ph.replaceChildren(arrow, nm, tx);
}

// 값이 같으면 건드리지 않음 (불필요한 style 속성 갱신 방지)
const setDisplay = (el, v) => { if (el.style.display !== v) el.style.display = v; };

// 메시지 하나의 접힘 표시를 갱신. 클래스 토글이 전부라서 매우 가볍다.
function render(mes) {
    const id = Number(mes.getAttribute('mesid'));
    const folded = isFolded(id);                 // 저장된 접힘 상태
    const collapsed = folded && openId !== id;   // 실제로 접혀 보이는지 (임시로 펼친 경우 제외)

    const unseen = settings().tintUnseen && folded && !!chat[id]?.extra?.[UNSEEN_KEY];   // 자동 접힘 후 아직 안 눌러본 상태 (색 덧입힘 설정이 켜져 있을 때만)
    const replaceFold = linkMode() === 'replace';                // Fold 대체 모드면 별도 fold 아이콘은 숨김

    mes.classList.toggle('mf-folded', collapsed);
    mes.classList.toggle('mf-pinned', folded);
    mes.classList.toggle('mf-unseen', collapsed && unseen);

    // 액션 아이콘: 저장 상태에 따라 두 버튼 중 하나만 보이게 (hide/unhide 와 같은 방식)
    const foldBtn = mes.querySelector('.mes_fold');
    if (foldBtn) {
        // 예전 버전(아이콘이 번갈아 바뀌던 단일 버튼)에서 남은 클래스 정리
        foldBtn.classList.remove(ICON_UNSET);
        foldBtn.classList.add(ICON_SET);
        if (foldBtn.title !== TITLE_SET) foldBtn.title = TITLE_SET;
        setDisplay(foldBtn, (folded || replaceFold) ? 'none' : '');
    }
    const unfoldBtn = mes.querySelector('.mes_unfold');
    if (unfoldBtn) {
        setDisplay(unfoldBtn, (folded && !replaceFold) ? '' : 'none');
    }

    // 접힌 메시지만 바 내용을 준비 (보이고 숨기는 건 CSS 가 .mf-folded 로 처리)
    if (folded) {
        const ph = mes.querySelector('.mf-placeholder');
        if (ph) ensureBar(ph, id);
    }
}

// id 로 메시지를 찾아 그 메시지만 갱신
function renderById(id) {
    if (id === null || id === undefined) return;
    const mes = document.querySelector(`#chat .mes[mesid="${id}"]`);
    if (mes) render(mes);
}

function decorate(mes) {
    const id = Number(mes.getAttribute('mesid'));
    if (Number.isNaN(id) || !chat[id]) return;

    // 메시지 액션 버튼
    // (다른 확장이 버튼을 .extraMesButtons 밖으로 옮겼을 수 있으므로 mes 전체에서 찾는다)
    const buttons = mes.querySelector('.extraMesButtons');
    let foldBtn = mes.querySelector('.mes_fold');
    if (buttons && !foldBtn) {
        foldBtn = document.createElement('div');
        foldBtn.className = `mes_button mes_fold fa-solid ${ICON_SET} interactable`;
        foldBtn.tabIndex = 0;
        foldBtn.title = TITLE_SET;
        buttons.prepend(foldBtn);
    }
    if (foldBtn && !mes.querySelector('.mes_unfold')) {
        const unfoldBtn = document.createElement('div');
        unfoldBtn.className = `mes_button mes_unfold fa-solid ${ICON_UNSET} interactable`;
        unfoldBtn.tabIndex = 0;
        unfoldBtn.title = TITLE_UNSET;
        foldBtn.after(unfoldBtn); // fold 바로 뒤 (같은 자리에서 교체되는 짝)
    }

    // 접혔을 때 메시지를 대신할 한 줄 바 (.mes_block 안 -> 기존 메시지 블록과 폭 동일)
    if (!mes.querySelector('.mf-placeholder')) {
        const ph = document.createElement('div');
        ph.className = 'mf-placeholder';
        ph.title = 'Click to expand temporarily';
        ph.tabIndex = 0;
        (mes.querySelector('.mes_block') ?? mes).append(ph);
    }

    render(mes);
}

// 슬래시 명령어로 만든 메시지(/comment, /sendas 등)를 자동으로 접고 / 숨김 (메시지마다 각각 딱 한 번만)
function autoProcessComments() {
    const st = settings();
    if (st.autoScope === 'none') return;
    if (!st.autoFoldComments && !st.autoHideComments) return;

    let changed = false;
    const toHide = [];
    chat.forEach((msg, id) => {
        if (!isAutoTarget(msg, id)) return;
        msg.extra ??= {};
        if (st.autoFoldComments && !msg.extra[AUTO_KEY]) {
            msg.extra[AUTO_KEY] = true;
            msg.extra[KEY] = true;
            msg.extra[UNSEEN_KEY] = true;
            changed = true;
        }
        if (st.autoHideComments && !msg.extra[AUTO_HIDE_KEY]) {
            msg.extra[AUTO_HIDE_KEY] = true;
            changed = true;
            if (!msg.is_system) toHide.push(id);   // (comment 는 원래 is_system 이라 /hide 가 필요 없음)
            else if (st.linkHideFold && !isFolded(id)) setFold(id, true);   // 이미 숨김 상태인 comment 도 연동이 켜져 있으면 같이 접음
        }
    });
    if (changed) saveChatConditional();

    // 숨김은 SillyTavern 의 /hide 를 그대로 사용 (DOM, 저장 처리를 맡김)
    if (toHide.length) {
        const { executeSlashCommandsWithOptions } = ctx();
        (async () => {
            for (const id of toHide) {
                try { await executeSlashCommandsWithOptions(`/hide ${id}`); } catch (e) { console.warn('[Message Fold] auto-hide failed', id, e); }
            }
        })();
    }
}

function refreshAll() {
    autoProcessComments();
    document.querySelectorAll('#chat .mes').forEach(decorate);
}

let scheduled = false;
function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        refreshAll();
    });
}

// 저장 상태만 바꿈 (저장 호출은 호출한 쪽에서). 실제로 바뀌었으면 true
function setFold(id, value) {
    const msg = chat[id];
    if (!msg) return false;
    if (isFolded(id) === value) return false;

    msg.extra ??= {};
    if (value) {
        msg.extra[KEY] = true;
    } else {
        delete msg.extra[KEY];
        delete msg.extra[UNSEEN_KEY];   // 접기 해제하면 색 덧입힘도 같이 제거
    }
    if (openId === id) openId = null;

    const mes = document.querySelector(`#chat .mes[mesid="${id}"]`);
    if (mes) render(mes);
    return true;
}

// 접기 설정 / 해제 (저장 상태 변경) - 액션 아이콘 & 길게 누르기 팝업 공용
async function toggleFold(mes) {
    const id = Number(mes.getAttribute('mesid'));
    if (!chat[id]) return;

    setFold(id, !isFolded(id));
    openId = null;

    render(mes);
    await saveChatConditional();
}

// 접힌 바를 눌렀을 때: 임시로 펼침 (저장 상태 변화 없음)
function openTemp(mes) {
    const id = Number(mes.getAttribute('mesid'));
    if (Number.isNaN(id) || !isFolded(id)) return;

    // 자동 접힘 후 처음 누르는 순간 → 색 덧입힘 변수 제거
    const extra = chat[id]?.extra;
    if (extra?.[UNSEEN_KEY]) {
        delete extra[UNSEEN_KEY];
        saveChatConditional();
    }

    lastTap = { id: -1, time: 0 };   // 바를 연 클릭이 더블클릭의 첫 번째로 계산되지 않게
    if (openId === id) return;
    const prev = openId;
    openId = id;
    renderById(prev);   // 이전에 펼쳐져 있던 메시지는 다시 접고
    render(mes);        // 새로 누른 메시지만 펼침 (나머지 메시지는 건드리지 않음)
}

// 더블클릭/더블탭 감지용 (모바일은 dblclick 이 불안정해서 click 시각으로 직접 판정)
const DBLCLICK_MS = 350;
let lastTap = { id: -1, time: 0 };

// 임시로 펼친 메시지를 다시 접음
function closeTemp() {
    if (openId === null) return;
    const prev = openId;
    openId = null;
    renderById(prev);
}

function onDocumentClick(e) {
    const el = e.target;
    if (!(el instanceof Element)) return;

    // 1) 접기 설정/해제 아이콘
    const foldBtn = el.closest(FOLD_BTN_SELECTOR);
    if (foldBtn) {
        const mes = foldBtn.closest('.mes');
        if (mes) toggleFold(mes);
        return;
    }

    // 2) 접힌 바 → 임시로 펼침 (다른 챗이 펼쳐져 있었다면 자동으로 접힘)
    const bar = el.closest('.mf-placeholder');
    if (bar) {
        const mes = bar.closest('.mes');
        if (mes) openTemp(mes);
        return;
    }

    // 3) 그 외: 임시로 펼쳐진 챗이 없으면 할 일 없음
    if (openId === null) return;

    // 상단바 / 하단바 / 팝업 등은 무시
    if (el.closest(IGNORE_SELECTOR)) return;

    const dbl = settings().closeMode === 'dblclick';

    // 펼쳐진 챗 자신을 누른 경우
    const mes = el.closest('#chat .mes');
    if (mes && Number(mes.getAttribute('mesid')) === openId) {
        // 더블클릭 모드: 같은 메시지를 짧은 간격으로 두 번 누르면 다시 접음
        if (dbl && !el.closest(LP_IGNORE) && !mes.querySelector('#curEditTextarea')) {
            const now = Date.now();
            if (lastTap.id === openId && now - lastTap.time < DBLCLICK_MS) {
                lastTap = { id: -1, time: 0 };
                window.getSelection()?.removeAllRanges();   // 더블클릭으로 선택된 단어 해제
                closeTemp();
            } else {
                lastTap = { id: openId, time: now };
            }
        }
        return;   // 그 외에는 그대로 유지
    }

    // 더블클릭 모드에서는 다른 곳을 눌러도 접히지 않음
    if (dbl) return;

    // 편집 중인 챗은 접지 않음
    const openMes = document.querySelector(`#chat .mes[mesid="${openId}"]`);
    if (openMes?.querySelector('#curEditTextarea')) return;

    // 다른 챗 / 빈 곳 → 다시 접기
    closeTemp();
}

// ===================== Long Press Menu =====================

const ctx = () => SillyTavern.getContext();

// 모든 채팅 스타일(Flat / Bubble / Document)에서 작동
const styleEnabled = () => true;

const escapeHtml = (t) => t.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const hasSelection = () => {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed && sel.toString().length > 0;
};

// ===================== 선택한 텍스트 길게 누르기 메뉴 =====================

const SEL_HIT_PAD = 4;

// 현재 선택이 "한 메시지의 본문(.mes_text) 안"에 있을 때만 정보를 돌려줌
function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const rawText = range.toString();
    if (!rawText.trim()) return null;

    const elOf = (n) => (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement);
    const a = elOf(range.startContainer)?.closest('.mes_text');
    const b = elOf(range.endContainer)?.closest('.mes_text');
    if (!a || a !== b) return null;
    const mes = a.closest('.mes');
    if (!mes) return null;

    // 앞뒤 공백은 제외 (더블클릭 선택 시 뒤 공백이 딸려오는 경우 대비)
    const lead = rawText.length - rawText.trimStart().length;
    const text = rawText.trim();

    // 같은 글자가 여러 번 나올 때를 대비해, 선택 위치 앞에 같은 글자가 몇 번 있었는지 센다
    const pre = document.createRange();
    pre.selectNodeContents(a);
    pre.setEnd(range.startContainer, range.startOffset);
    const startOffset = pre.toString().length + lead;
    const full = a.textContent;
    let occurrence = 0;
    for (let i = full.indexOf(text); i !== -1 && i < startOffset; i = full.indexOf(text, i + 1)) occurrence++;

    // 선택이 걸친 <p> 들의 범위 (여러 문단에 걸쳐도 됨). 경계에 닿기만 하고 글자가 안 걸린 문단은 제외
    const ps = paraList(a);
    const hasText = (p) => {
        const r = document.createRange();
        r.selectNodeContents(p);
        if (p.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
        if (p.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
        return r.toString().trim() !== '';
    };
    const hit = ps.map((p, i) => ({ p, i })).filter(({ p }) => range.intersectsNode(p) && hasText(p));
    const para = hit.length
        ? {
            index: hit[0].i,
            last: hit[hit.length - 1].i,
            count: ps.length,
            text: hit.map((h) => h.p.textContent.trim()).join('\n\n'),
        }
        : null;

    // LLM 번역 확장 "원문<>번역문 함께 보기" 모드: 선택이 걸친 줄(span)들의 "번역 쪽" span 목록.
    // 원문 span 을 골랐으면 그 짝(같은 details 안, 또는 바로 옆 span)의 번역 span 으로 바꿔 둔다.
    let trans = null;
    const SPAN_SEL = '.translated_text, .original_text';
    const allSpans = [...a.querySelectorAll(SPAN_SEL)];
    if (allSpans.length) {
        const partnerOf = (sp) => {
            const isT = sp.classList.contains('translated_text');
            const want = isT ? '.original_text' : '.translated_text';
            const d = sp.closest('details');
            if (d) return d.querySelector(want);
            for (const dir of ['nextElementSibling', 'previousElementSibling']) {
                let n = sp[dir];
                if (n && n.tagName === 'BR') n = n[dir];
                if (n?.matches?.(want)) return n;
            }
            return null;
        };
        const allT = [...a.querySelectorAll('.translated_text')];
        const picked = [];
        for (const sp of allSpans) {
            if (!(range.intersectsNode(sp) && hasText(sp))) continue;
            const t = sp.classList.contains('translated_text') ? sp : partnerOf(sp);
            if (t && !picked.includes(t)) picked.push(t);
        }
        if (picked.length) {
            // 선택 범위 안에서 "그 번역 span 에 속한 부분"만 잘라낸 글자.
            // range.toString() 은 접힌 <details> 안의 숨은 원문까지 전부 이어 붙이므로, 번역 줄 글자만 따로 모은다.
            const clipText = (el) => {
                const r = document.createRange();
                r.selectNodeContents(el);
                if (el.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
                if (el.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
                return r.toString();
            };
            const tg = picked
                .map((t) => ({ index: allT.indexOf(t), text: t.textContent, sel: clipText(t) }))
                .filter((x) => x.index >= 0);
            trans = {
                count: allT.length,
                targets: tg,
                selText: tg.map((x) => (x.sel.trim() || x.text.trim())).join('\n'),
            };
        }
    }

    // 선택이 번역 span 한 개 안에 있으면, 그 줄 안에서 같은 글자가 앞에 몇 번 나왔는지 (번역 줄 안 정확한 위치 찾기용)
    if (trans && trans.targets.length === 1) {
        const sT = elOf(range.startContainer)?.closest('.translated_text');
        const eT = elOf(range.endContainer)?.closest('.translated_text');
        const tsel = trans.selText;
        if (sT && sT === eT && tsel) {
            const pre = document.createRange();
            pre.selectNodeContents(sT);
            pre.setEnd(range.startContainer, range.startOffset);
            const D = sT.textContent;
            const q = D.indexOf(tsel, pre.toString().length);
            if (q >= 0) {
                let occ = 0;
                for (let i = D.indexOf(tsel); i !== -1 && i < q; i = D.indexOf(tsel, i + 1)) occ++;
                trans.occ = occ;
                // 번역 줄 전체(문서 순서)에서 앞에 몇 번 나왔는지 → DB 번역문에서 같은 위치를 찾는 용도
                let before = 0;
                for (const t of a.querySelectorAll('.translated_text')) {
                    if (t === sT) break;
                    const tt = t.textContent;
                    for (let i = tt.indexOf(tsel); i !== -1; i = tt.indexOf(tsel, i + 1)) before++;
                }
                trans.occAll = before + occ;
            }
        }
    }

    return { mes, text, occurrence, para, trans };
}

// (x, y) 가 현재 선택 영역 위인지
function pointOnSelection(x, y) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    for (const rc of sel.getRangeAt(0).getClientRects()) {
        if (x >= rc.left - SEL_HIT_PAD && x <= rc.right + SEL_HIT_PAD &&
            y >= rc.top - SEL_HIT_PAD && y <= rc.bottom + SEL_HIT_PAD) {
            return true;
        }
    }
    return false;
}

// 화면에 보이는 글자를 저장된 텍스트(원문 또는 번역문)에서 찾음
function findInRaw(raw, text, occurrence) {
    const idx = [];
    for (let i = raw.indexOf(text); i !== -1; i = raw.indexOf(text, i + 1)) idx.push(i);
    if (!idx.length) return null;
    const start = idx[occurrence] ?? (idx.length === 1 ? idx[0] : undefined);
    return start === undefined ? null : { start, end: start + text.length };
}

// display_text 값을 쓰거나(빈 값이면 삭제) 현재 스와이프의 extra 에도 같이 반영
function writeDisplayText(msg, next) {
    msg.extra ??= {};
    const swipeExtra = Array.isArray(msg.swipe_info) ? msg.swipe_info[msg.swipe_id]?.extra : null;
    if (next) {
        msg.extra.display_text = next;
        if (swipeExtra) swipeExtra.display_text = next;
    } else {
        delete msg.extra.display_text;
        if (swipeExtra) delete swipeExtra.display_text;
    }
}

// 메시지 본문(mes)을 통째로 교체하고 저장 (SillyTavern 기본 편집 저장과 같은 순서)
//  opts.display: 같이 바꿀 display_text (함께 보기 모드에서 원문 줄을 고칠 때 화면의 원문 줄도 맞추려고 사용)
async function setMessageText(id, next, opts = {}) {
    const msg = chat[id];
    if (!msg) return;
    msg.mes = next;
    if (Array.isArray(msg.swipes) && Number.isInteger(msg.swipe_id) && msg.swipes[msg.swipe_id] !== undefined) {
        msg.swipes[msg.swipe_id] = next;
    }
    // LLM 번역 확장은 MESSAGE_UPDATED 때 "저장된 기준 원문 != 현재 mes" 이면 번역을 지우고 재번역함.
    // 우리가 고친 원문을 기준 원문으로 같이 갱신해서, 원문을 고쳐도 번역이 날아가지 않게 함
    if (msg.extra?.original_text_for_translation !== undefined) {
        const c = ctx();
        msg.extra.original_text_for_translation = c.substituteParams ? c.substituteParams(next, c.name1, msg.name) : next;
    }
    if (opts.display !== undefined) writeDisplayText(msg, opts.display);
    updateMessageBlock(id, msg);
    await eventSource.emit(event_types.MESSAGE_EDITED, id);
    await eventSource.emit(event_types.MESSAGE_UPDATED, id);
    await saveChatConditional();
}

// 화면에 보이는 번역문(extra.display_text)만 교체하고 저장. mes(프롬프트에 들어가는 원문)는 건드리지 않음.
// MESSAGE_EDITED 는 일부러 보내지 않음 (번역 확장이 자동 재번역으로 덮어쓰는 것 방지)
async function setDisplayText(id, next) {
    const msg = chat[id];
    if (!msg) return;
    writeDisplayText(msg, next);
    updateMessageBlock(id, msg);
    await eventSource.emit(event_types.MESSAGE_UPDATED, id);
    await saveChatConditional();
}

// ----- 편집 대상 필드: 'mes'(원문) / 'display_text'(번역문) -----
const hasDisplayText = (id) => !!chat[id]?.extra?.display_text;
const getField = (id, field) => String(field === 'display_text' ? (chat[id]?.extra?.display_text ?? '') : (chat[id]?.mes ?? ''));
const setField = (id, field, next) => (field === 'display_text' ? setDisplayText(id, next) : setMessageText(id, next));

async function replaceSelection(id, field, text, occurrence, replacement) {
    const raw = getField(id, field);
    const loc = findInRaw(raw, text, occurrence);
    if (!loc) {
        window.toastr?.warning('Could not locate the selected text in the message source.');
        return;
    }
    await setField(id, field, raw.slice(0, loc.start) + replacement + raw.slice(loc.end));
}

const countOccurrences = (raw, text) => (text ? raw.split(text).length - 1 : 0);

// ===================== 문단(<p>) 단위 매칭 =====================
// 글자가 그대로 일치하지 않을 때(마크다운/XML/정규식/번역) 쓰는 폴백.
// 우리가 마크다운 규칙을 흉내 내지 않고, SillyTavern 본체의 messageFormatting 을 그대로 돌려서
// 나온 <p> 개수로 "화면의 n번째 문단 = 저장 텍스트의 n번째 문단" 을 맞춘다.

// <p> 중에서 코드블록/표 안의 것은 양쪽 모두 세지 않음
const paraList = (root) => [...root.querySelectorAll('p')].filter((p) => !p.closest('pre, table, code'));

let _fmt = null;
async function getFormatter() {
    if (_fmt) return _fmt;
    try {
        // 정적 import 로 두면 messageFormatting 이 없는 버전에서 확장 전체가 로드 실패하므로 동적 import
        const mod = await import('../../../../script.js');
        if (typeof mod.messageFormatting === 'function') _fmt = mod.messageFormatting;
    } catch (e) {
        console.warn('[message-fold] messageFormatting unavailable', e);
    }
    return _fmt;
}

// 텍스트를 빈 줄 기준 블록으로 나눔 (코드펜스 안의 빈 줄은 무시). 각 블록의 원문 내 위치를 같이 돌려줌
function splitBlocks(text) {
    const blocks = [];
    let pos = 0, cur = null, fence = null;
    for (const line of text.split('\n')) {
        const lineStart = pos;
        const lineEnd = pos + line.length;
        pos = lineEnd + 1;
        const t = line.trim();
        const fm = /^(```|~~~)/.exec(t);
        if (fm) {
            if (!fence) fence = fm[1];
            else if (fm[1] === fence) fence = null;
        }
        if (t === '' && !fence) {
            if (cur) { blocks.push(cur); cur = null; }
            continue;
        }
        if (!cur) cur = { start: lineStart, end: lineEnd };
        else cur.end = lineEnd;
    }
    if (cur) blocks.push(cur);
    return blocks.map((b) => ({ ...b, text: text.slice(b.start, b.end) }));
}

// 화면에서 고른 문단(para.index)에 대응하는 저장 텍스트 블록을 찾는다. 실패하면 null (→ 메시지 통째 편집)
async function mapParagraph(id, field, para) {
    if (!para || para.index < 0) return null;
    const fmt = await getFormatter();
    if (!fmt) return null;
    const msg = chat[id];
    const val = getField(id, field);
    const countP = (s) => {
        const html = fmt(s, msg.name, !!msg.is_system, !!msg.is_user, id);
        const doc = new DOMParser().parseFromString(String(html), 'text/html');   // 비활성 문서: 이미지 로드/스크립트 실행 없음
        return paraList(doc.body).length;
    };
    try {
        const blocks = splitBlocks(val);
        let acc = 0;
        for (const b of blocks) { b.from = acc; acc += countP(b.text); b.to = acc; }
        // 검증 1: 블록별로 센 합계 == 통째로 센 개수 (리스트/인용문/정규식 때문에 쪼개면 달라지는 경우 걸러냄)
        if (acc !== countP(val)) { console.debug('[message-fold] block sum != whole', acc, countP(val)); return null; }
        // 검증 2: 화면(DOM)의 문단 수와 같아야 함 (원문 ↔ 번역문 짝이 안 맞거나 정규식이 <p>를 만든 경우 걸러냄)
        if (acc !== para.count) { console.debug('[message-fold] p count mismatch', acc, para.count); return null; }
        const last = para.last ?? para.index;
        const b0 = blocks.find((b) => para.index >= b.from && para.index < b.to);
        const b1 = blocks.find((b) => last >= b.from && last < b.to);
        if (!b0 || !b1) return null;
        return { start: b0.start, end: b1.end, text: val.slice(b0.start, b1.end), index: para.index, last, count: acc };
    } catch (e) {
        console.warn('[message-fold] paragraph mapping failed', e);
        return null;
    }
}

// 문단 단위(성공 시) 또는 메시지 통째(실패 시)로 편집창을 띄워 수정
async function editByParagraph(mes, id, field, info, name) {
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const map = await mapParagraph(id, field, info.para);
    const val = getField(id, field);
    const start = map ? map.start : 0;
    const end = map ? map.end : val.length;
    const seed = val.slice(start, end);

    const fieldLabel = field === 'display_text' ? 'translation' : 'original';
    const rangeLabel = map && map.last > map.index ? `${map.index + 1}–${map.last + 1}` : map ? `${map.index + 1}` : '';
    const scope = map ? `${fieldLabel} paragraph ${rangeLabel} / ${map.count}` : `whole ${fieldLabel} message`;
    // 번역문이 있는 상태에서 원문을 고칠 때는 "화면에서 고른 문단"을 같이 보여줘서 짝이 맞는지 눈으로 확인하게 함
    const peek = (map && field === 'mes' && info.para?.text)
        ? `<div style="text-align:left;opacity:.7;margin-top:8px;font-size:.9em">Matched by position to the displayed paragraph:<br>“${escapeHtml(info.para.text.length > 160 ? info.para.text.slice(0, 160) + '…' : info.para.text)}”<br><i>Check that the text below really is its source.</i></div>`
        : '';
    const note = map ? '' : `<div style="text-align:left;opacity:.7;margin-top:8px;font-size:.9em">Couldn't match this to a single paragraph, so the whole message is shown.</div>`;

    const edited = await callGenericPopup(
        `<h3>Edit ${fieldLabel}</h3>
         <div style="text-align:left;opacity:.8;margin-top:8px"><b>#${id}</b> ${escapeHtml(name)} · ${scope}</div>${peek}${note}`,
        POPUP_TYPE.INPUT,
        seed,
        { rows: map ? Math.min(16, 6 + 3 * (map.last - map.index)) : 16, okButton: 'Save', cancelButton: 'Cancel' },
    );
    if (typeof edited !== 'string' || edited === seed) return;
    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    // 편집창이 떠 있는 동안 내용이 바뀌었으면 중단
    const cur = getField(id, field);
    if (cur.slice(start, end) !== seed) {
        window.toastr?.warning('The message changed; nothing was replaced.');
        return;
    }
    await setField(id, field, cur.slice(0, start) + edited + cur.slice(end));
}

// 화면 글자가 저장 텍스트에 그대로 있을 때: 정확한 위치를 바꾸거나 지움 (기존 방식)
async function editExact(mes, id, field, action, info, name, sourceLabel) {
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const { text, occurrence } = info;

    if (action === 'delete') {
        await replaceSelection(id, field, text, occurrence, '');
        return;
    }

    // ----- Edit selection: 바꿀 글자를 입력. 같은 글자가 여러 개면 "모두 바꾸기" 체크박스 표시 -----
    const total = countOccurrences(getField(id, field), text);
    let replaceAll = false;
    const checkbox = total > 1
        ? `<label class="checkbox_label" style="justify-content:center;margin-top:10px">
               <input type="checkbox" id="mf-replace-all">
               <span>Replace all ${total} occurrences in this ${sourceLabel}</span>
           </label>`
        : '';

    const edited = await callGenericPopup(
        `<h3>Edit selection</h3>
         <div style="text-align:left;opacity:.8;margin-top:8px"><b>#${id}</b> ${escapeHtml(name)}${field === 'display_text' ? ' · translation only' : ''}</div>
         ${checkbox}`,
        POPUP_TYPE.INPUT,
        text,
        {
            rows: 4,
            okButton: 'Save',
            cancelButton: 'Cancel',
            onOpen: () => {
                const cb = document.getElementById('mf-replace-all');
                cb?.addEventListener('change', () => { replaceAll = cb.checked; });
            },
        },
    );
    if (typeof edited !== 'string' || edited === text) return;
    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    if (replaceAll) {
        const cur = getField(id, field);
        if (!cur.includes(text)) {
            window.toastr?.warning('The message changed; nothing was replaced.');
            return;
        }
        await setField(id, field, cur.split(text).join(edited));
        window.toastr?.success(`Replaced ${countOccurrences(cur, text)} occurrence(s).`);
    } else {
        await replaceSelection(id, field, text, occurrence, edited);
    }
}

// ===================== LLM 번역 확장 감지 + 번역문만 수정 =====================
// LLM 번역이 떠 있으면 원문(mes)은 절대 건드리지 않고 번역문(display_text)만 수정한다.
// "원문<>번역문 함께 보기" 모드의 display_text 는
//   <details class="llm-translator-details"><summary><span class="translated_text">번역</span></summary><span class="original_text">원문</span></details>
// 같은 HTML 이지만, 편집창에는 번역 줄의 "내용"만 보여주고 저장할 때 그 span 안쪽만 바꿔 끼운다. (껍데기 태그는 안 보임)

// display_text 문자열에서 translated_text / original_text span 을 순서대로 뽑음 (중첩 span 도 짝 맞춰서 처리)
function parseDualSpans(html) {
    const spans = [];
    const openRe = /<span class="(translated_text|original_text)(?:\s[^"]*)?">/g;
    let m;
    while ((m = openRe.exec(html))) {
        const innerStart = m.index + m[0].length;
        const tagRe = /<(\/?)span\b[^>]*>/gi;
        tagRe.lastIndex = innerStart;
        let depth = 1, t;
        while ((t = tagRe.exec(html))) {
            depth += t[1] ? -1 : 1;
            if (!depth) break;
        }
        if (depth) continue;
        spans.push({
            kind: m[1] === 'translated_text' ? 'translated' : 'original',
            start: innerStart,
            end: t.index,
            text: html.slice(innerStart, t.index),
        });
        openRe.lastIndex = t.index + t[0].length;
    }
    return spans;
}

// 이 메시지의 display_text 가 LLM 번역 확장이 만든 것인지
function isLlmTranslated(id) {
    const msg = chat[id];
    const dt = msg?.extra?.display_text;
    if (!dt) return false;
    return msg.extra.original_text_for_translation !== undefined
        || /class="(?:llm-translator|translated_text|original_text)/.test(dt);
}

const stripTags = (s) => new DOMParser().parseFromString(String(s), 'text/html').body.textContent;
const normText = (s) => stripTags(s).replace(/\s+/g, ' ').trim();
const SPAN_DIVIDER = '\n\n──────────\n\n';

// 화면에서 고른 번역 span(info.trans) 들을 display_text 의 번역 span 들에 대응시킴.
// 개수가 같으면 순서로, 다르면 글자 비교로. 둘 다 실패하면 null
function mapTranslatedSpans(pt, trans) {
    if (!trans || !trans.targets.length) return null;
    if (pt.length === trans.count) return trans.targets.map((t) => pt[t.index]).filter(Boolean);
    const out = [];
    let from = 0;
    for (const t of trans.targets) {
        const want = normText(t.text);
        const j = pt.findIndex((p, i) => i >= from && normText(p.text) === want);
        if (j < 0) return null;
        out.push(pt[j]);
        from = j + 1;
    }
    return out;
}

// ---------- 번역 span 소스(마크다운/HTML 태그가 섞여 있을 수 있음)에서 "화면에 보이는 글자"만 다루는 도구 ----------
const VIS_ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

// mode 0: 소스 그대로 / 1: 태그, 엔티티, 마크다운 기호(* ~ ` \)를 건너뜀 / 2: _ 까지 건너뜀
// plain: 화면에 보이는 글자열, ranges[i]: plain[i] 가 소스에서 차지하는 [시작, 끝)
function visibleModel(src, mode) {
    const chars = [];
    const ranges = [];
    for (let i = 0; i < src.length;) {
        const c = src[i];
        if (mode > 0) {
            if (c === '<' && /^<\/?[a-zA-Z!]/.test(src.slice(i, i + 3))) {
                const e = src.indexOf('>', i);
                if (e > 0) { i = e + 1; continue; }
            }
            if (c === '&') {
                const ent = Object.keys(VIS_ENT).find((k) => src.startsWith(k, i));
                if (ent) { chars.push(VIS_ENT[ent]); ranges.push([i, i + ent.length]); i += ent.length; continue; }
            }
            if (c === '*' || c === '~' || c === '`' || (mode > 1 && c === '_')) { i++; continue; }
            if (c === '\\' && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!~<>|]/.test(src[i + 1])) {
                chars.push(src[i + 1]); ranges.push([i, i + 2]); i += 2; continue;
            }
        }
        chars.push(c === '\u00a0' ? ' ' : c);
        ranges.push([i, i + 1]);
        i++;
    }
    return { plain: chars.join(''), ranges };
}

// 지정한 범위들만 소스에서 빼고(= 사이에 낀 태그/기호는 그대로 둠) 첫 범위 자리에 replacement 를 넣음
function removeRanges(src, ranges, replacement = '') {
    let out = '';
    let last = 0;
    let inserted = false;
    for (const [s, e] of ranges) {
        out += src.slice(last, s);
        if (!inserted) { out += replacement; inserted = true; }
        last = e;
    }
    return out + src.slice(last);
}

// 글자를 지운 뒤 비어 버린 서식(<i></i>, *…* 의 빈 껍데기 **, ****, ~~~~)을 정리
function tidyEmptyMarkup(src, doTidy) {
    if (!doTidy) return src;
    let cur = src;
    for (let n = 0; n < 5; n++) {
        const next = cur.replace(/<([a-zA-Z][\w-]*)\b[^>]*>\s*<\/\1>/g, '').replace(/(?<!\*)(?:\*{4}|\*{6})(?!\*)|~{4}/g, '');
        if (next === cur) break;
        cur = next;
    }
    return cur;
}

// 화면에서 고른 글자(sel)를 소스에서 찾음. occ: 앞에서부터 몇 번째인지 (숫자) 또는 'last'
// 반환: { shown(태그 없는 선택 글자), apply(replacement) → 바뀐 소스 } 또는 null
function locateVisible(src, sel, occ) {
    sel = String(sel).replace(/\u00a0/g, ' ');
    if (!sel.trim()) return null;
    const pick = (idx) => (occ === 'last' ? idx[idx.length - 1] : (idx[occ] ?? idx[0]));
    // [서식 건너뛰기 단계, 공백/줄바꿈 무시 여부]
    for (const [mode, ws] of [[0, false], [1, false], [2, false], [1, true], [2, true]]) {
        const { plain, ranges } = visibleModel(src, mode);
        if (!ws) {
            const idx = [];
            for (let i = plain.indexOf(sel); i !== -1; i = plain.indexOf(sel, i + 1)) idx.push(i);
            if (!idx.length) continue;
            const at = pick(idx);
            const sub = ranges.slice(at, at + sel.length);
            return { shown: plain.slice(at, at + sel.length), apply: (rep) => tidyEmptyMarkup(removeRanges(src, sub, rep), rep === '') };
        }
        // 연속된 공백/줄바꿈을 공백 하나로 보고 비교 (여러 줄에 걸친 선택용)
        const cp = [];
        const cmap = [];
        let prevWs = false;
        for (let i = 0; i < plain.length; i++) {
            const isWs = /\s/.test(plain[i]);
            if (isWs && prevWs) continue;
            cp.push(isWs ? ' ' : plain[i]);
            cmap.push(i);
            prevWs = isWs;
        }
        const cplain = cp.join('');
        const selC = sel.replace(/\s+/g, ' ').trim();
        const idx = [];
        for (let i = cplain.indexOf(selC); i !== -1; i = cplain.indexOf(selC, i + 1)) idx.push(i);
        if (!idx.length) continue;
        const at = pick(idx);
        const p0 = cmap[at];
        const p1 = cmap[at + selC.length - 1];
        const sub = ranges.slice(p0, p1 + 1);
        return { shown: plain.slice(p0, p1 + 1), apply: (rep) => tidyEmptyMarkup(removeRanges(src, sub, rep), rep === '') };
    }
    return null;
}

// ---------- ST 본체 변환(정규식 + 마크다운)을 거친 "화면 글자"로 위치 찾기 ----------
// 소스 문자열을 messageFormatting 에 통과시켜 화면에 실제로 보이는 글자열(R)을 만들고,
// 드래그한 글자를 R 에서 찾은 뒤, R 의 각 글자가 소스의 어느 글자에서 왔는지(글자 정렬)로 소스 위치를 되돌린다.
// 마크다운/정규식 규칙을 우리가 재현하지 않으므로 ST 와 어긋나지 않는다.

// 두 글자열을 정렬해서 b 의 각 글자가 a 의 몇 번째 글자에 대응하는지 돌려줌 (대응 없으면 -1). 너무 크면 null
function alignChars(a, b) {
    const n = a.length, m = b.length;
    const map = new Int32Array(m).fill(-1);
    let pre = 0;
    while (pre < n && pre < m && a[pre] === b[pre]) { map[pre] = pre; pre++; }
    let sa = n, sb = m;
    while (sa > pre && sb > pre && a[sa - 1] === b[sb - 1]) { sa--; sb--; map[sb] = sa; }
    const N = sa - pre, M = sb - pre;
    if (N === 0 || M === 0) return map;
    if (N * M > 6e6) return null;
    const W = M + 1;
    const dp = new Uint16Array((N + 1) * W);
    for (let i = N - 1; i >= 0; i--) {
        for (let j = M - 1; j >= 0; j--) {
            dp[i * W + j] = a[pre + i] === b[pre + j]
                ? dp[(i + 1) * W + j + 1] + 1
                : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        }
    }
    let i = 0, j = 0;
    while (i < N && j < M) {
        if (a[pre + i] === b[pre + j]) { map[pre + j] = pre + i; i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
        else j++;
    }
    return map;
}

// 변환된 HTML 에서 보이는 글자만 뽑음 (블록 사이/줄바꿈은 개행으로)
function renderedPlain(html) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll('script,style').forEach((e) => e.remove());
    doc.body.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    doc.body.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,div,blockquote,tr,pre').forEach((e) => e.append('\n'));
    return doc.body.textContent.replace(/\u00a0/g, ' ');
}

// fmtText(블록 소스) → 변환된 "보이는 글자열". 반환: { shown, apply(rep) } 또는 null
function locateRendered(src, sel, occ, fmtText) {
    sel = String(sel).replace(/\u00a0/g, ' ');
    const selC = sel.replace(/\s+/g, ' ').trim();
    if (!selC) return null;

    // 블록(빈 줄 기준)마다 변환하고 정렬해서 R 의 글자별 소스 위치를 모음
    const Rch = [];
    const Rpos = [];   // 글자가 소스에서 온 경우 [시작, 끝) (절대 위치), 아니면 null
    for (const b of splitBlocks(src)) {
        const { plain: P, ranges } = visibleModel(b.text, 1);
        const Rb = fmtText(b.text);
        const map = alignChars(P, Rb);
        for (let j = 0; j < Rb.length; j++) {
            Rch.push(Rb[j]);
            const i = map ? map[j] : -1;
            Rpos.push(i >= 0 ? [b.start + ranges[i][0], b.start + ranges[i][1]] : null);
        }
        Rch.push('\n');
        Rpos.push(null);
    }
    if (!Rch.length) return null;

    // 공백/줄바꿈 차이를 무시하고 선택 글자를 R 에서 찾음
    const cp = [];
    const cmap = [];
    let prevWs = false;
    for (let i = 0; i < Rch.length; i++) {
        const isWs = /\s/.test(Rch[i]);
        if (isWs && prevWs) continue;
        cp.push(isWs ? ' ' : Rch[i]);
        cmap.push(i);
        prevWs = isWs;
    }
    const cplain = cp.join('');
    const idx = [];
    for (let i = cplain.indexOf(selC); i !== -1; i = cplain.indexOf(selC, i + 1)) idx.push(i);
    if (!idx.length) return null;
    const at = occ === 'last' ? idx[idx.length - 1] : (idx[occ] ?? idx[0]);
    const p0 = cmap[at];
    const p1 = cmap[at + selC.length - 1];

    // 선택 구간 중 소스에서 온 글자만 대상으로 함 (정규식이 만든 글자는 건드리지 않음)
    const sub = [];
    let shown = '';
    let nonWs = 0;
    for (let k = p0; k <= p1; k++) {
        if (!/\s/.test(Rch[k])) nonWs++;
        if (Rpos[k]) { sub.push(Rpos[k]); shown += Rch[k]; }
    }
    const matchedNonWs = sub.filter((r) => !/\s/.test(src.slice(r[0], r[1]))).length;
    if (!sub.length || matchedNonWs < nonWs * 0.6) return null;   // 대부분이 정규식이 만든 글자면 신뢰하지 않음
    return { shown, apply: (rep) => tidyEmptyMarkup(removeRanges(src, sub, rep), rep === '') };
}

// 1순위: ST 본체 변환으로 찾기, 2순위: 간이 서식 제거로 찾기
async function locateBest(src, sel, occ, id) {
    try {
        const fmt = await getFormatter();
        const msg = chat[id];
        if (fmt && msg) {
            const fmtText = (t) => renderedPlain(fmt(t, msg.name, !!msg.is_system, !!msg.is_user, id));
            const hit = locateRendered(src, sel, occ, fmtText);
            if (hit) return hit;
        }
    } catch (e) {
        console.warn('[message-fold] rendered locate failed', e);
    }
    return locateVisible(src, sel, occ);
}

// ---------- LLM 번역 확장의 IndexedDB(LLMtranslatorDB / translations)를 직접 읽고 씀 ----------
// 번역 확장은 번역문을 "원문 텍스트"를 키로 여기에 저장하고, display_text 는 거기서 만들어 낸 값이다.
// 그래서 DB 의 번역문을 고친 뒤 /LlmTranslateID 를 부르면(DB 에 번역이 있으면 LLM 호출 없이) display_text 가 다시 만들어진다.
const LLM_DB_NAME = 'LLMtranslatorDB';
const LLM_STORE_NAME = 'translations';

function llmOpenDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(LLM_DB_NAME);
        req.onupgradeneeded = (e) => e.target.transaction.abort();   // DB 가 없으면 빈 DB 를 만들지 않음
        req.onerror = () => reject(new Error('indexedDB open error'));
        req.onsuccess = (e) => resolve(e.target.result);
    });
}

async function llmGetTranslation(originalText) {
    const db = await llmOpenDB();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(LLM_STORE_NAME, 'readonly');
            const req = tx.objectStore(LLM_STORE_NAME).index('originalText').get(originalText);
            req.onsuccess = () => resolve(req.result?.translation ?? null);
            req.onerror = () => reject(new Error('get error'));
        });
    } finally {
        db.close();
    }
}

async function llmPutTranslation(originalText, translation) {
    const db = await llmOpenDB();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(LLM_STORE_NAME, 'readwrite');
            const store = tx.objectStore(LLM_STORE_NAME);
            const req = store.index('originalText').get(originalText);
            req.onsuccess = () => {
                const rec = req.result;
                if (!rec) { resolve(false); return; }
                const put = store.put({ ...rec, translation });
                put.onerror = () => reject(new Error('put error'));
            };
            req.onerror = () => reject(new Error('get error'));
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(new Error('transaction error'));
        });
    } finally {
        db.close();
    }
}

// LLM 번역 편집의 기본 경로: DB 의 번역문을 고치고, 번역 확장이 화면용 display_text 를 다시 만들게 함.
// 원문(mes)은 건드리지 않음. DB 에서 못 찾거나 쓸 수 없으면 false (→ display_text 만 고치는 경로로 폴백)
async function editLlmViaDB(mes, id, action, info, name) {
    const c = ctx();
    if (!c.executeSlashCommandsWithOptions || !('indexedDB' in window)) return false;
    const msg = chat[id];
    const originalText = c.substituteParams ? c.substituteParams(msg.mes, c.name1, msg.name) : msg.mes;

    let tr;
    try {
        tr = await llmGetTranslation(originalText);
    } catch (e) {
        console.warn('[message-fold] LLM DB unavailable', e);
        return false;
    }
    if (typeof tr !== 'string' || !tr) return false;

    const selText = info.trans?.selText || info.text;
    const loc = await locateBest(tr, selText, info.trans?.occAll ?? 0, id);
    if (!loc) return false;

    let nextTr;
    if (action === 'delete') {
        nextTr = loc.apply('');
    } else {
        const edited = await c.callGenericPopup(
            `<h3>Edit selection</h3>
             <div style="text-align:left;opacity:.8;margin-top:8px"><b>#${id}</b> ${escapeHtml(name)} · translation only</div>`,
            c.POPUP_TYPE.INPUT,
            loc.shown,
            { rows: Math.min(10, Math.max(3, loc.shown.split('\n').length + 1)), okButton: 'Save', cancelButton: 'Cancel' },
        );
        if (typeof edited !== 'string' || edited === loc.shown) return true;
        nextTr = loc.apply(edited);
    }
    if (nextTr === tr) return true;
    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return true;

    // 편집창이 떠 있는 동안 원문이 바뀌었으면 중단
    const nowOriginal = c.substituteParams ? c.substituteParams(chat[id].mes, c.name1, chat[id].name) : chat[id].mes;
    if (nowOriginal !== originalText) {
        window.toastr?.warning('The message changed; nothing was replaced.');
        return true;
    }
    try {
        const ok = await llmPutTranslation(originalText, nextTr);
        if (!ok) return false;
    } catch (e) {
        console.warn('[message-fold] LLM DB write failed', e);
        window.toastr?.error('Could not write the translation DB.');
        return true;
    }
    // 번역 확장이 DB 의 번역문으로 display_text 를 다시 만들게 함 (LLM 호출 없음)
    try {
        await c.executeSlashCommandsWithOptions(`/LlmTranslateID messageId=${id}`);
    } catch (e) {
        console.warn('[message-fold] LlmTranslateID failed', e);
        window.toastr?.warning('Saved to the translation DB, but the display could not be refreshed. Press the translate button once.');
    }
    return true;
}

// LLM 번역 전용 편집. 번역 span 의 내용(display_text 안쪽)만 바꾸고, 원문(mes)과 껍데기 태그는 건드리지 않음.
//  action 'edit'   : 드래그한 글자를 바로 수정 (보이는 글자만 바뀌고, 사이에 낀 <i> 같은 태그는 그대로)
//  action 'delete' : 드래그한 글자를 바로 삭제 (여러 줄에 걸쳐도 됨)
//  action 'line'   : 드래그가 걸친 번역 줄(들) 전체를 태그 없이 편집
async function editTranslationSpans(mes, id, action, info, name) {
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const html = getField(id, 'display_text');
    const pt = parseDualSpans(html).filter((x) => x.kind === 'translated');
    if (!pt.length) return false;                       // 함께 보기 HTML 이 아님 → 호출한 쪽이 일반 경로로 처리

    const stillHere = () => mes.isConnected && Number(mes.getAttribute('mesid')) === id;
    const unchanged = () => getField(id, 'display_text') === html;
    let targets = mapTranslatedSpans(pt, info.trans);
    let exact = true;
    if (!targets || !targets.length) {                  // 어느 줄인지 못 정하면 번역 줄 전체를 대상으로 (그래도 태그는 안 보임)
        targets = pt;
        exact = false;
    }

    // ----- 삭제: 번역문에서만 지움 -----
    if (action === 'delete') {
        // 줄 하나 안: 그 줄 안에서 몇 번째 등장인지까지 맞춰서 정확히 지움
        // 여러 줄: 통째로 선택된 줄은 내용을 비우고, 양 끝의 일부만 걸친 줄은 선택된 부분만 지움
        const selText = info.trans?.selText || info.text;
        const selNorm = normText(selText);
        const segs = String(selText).split(/\n+/).map((x) => x.trim()).filter(Boolean);
        const cands = exact ? targets : pt;
        const edits = [];
        for (const [k, t] of cands.entries()) {
            let next = null;
            const vis = normText(t.text);
            if (cands.length === 1) {
                let loc = await locateBest(t.text, selText, info.trans?.occ ?? 0, id);
                for (const sg of segs) { if (loc) break; loc = await locateBest(t.text, sg, 0, id); }
                if (loc) next = loc.apply('');
            } else if (vis && selNorm.includes(vis)) {
                next = removeRanges(t.text, visibleModel(t.text, 1).ranges, '');
            } else {
                for (const sg of segs) {
                    const loc = await locateBest(t.text, sg, k === 0 ? 'last' : 0, id);
                    if (loc) { next = loc.apply(''); break; }
                }
            }
            if (next !== null && next !== t.text) edits.push({ t, next });
        }
        if (!edits.length) {
            window.toastr?.warning('Nothing to delete was found in the translation.');
            return true;
        }
        if (!stillHere() || !unchanged()) return true;
        let out = html;
        for (const { t, next } of edits.sort((x, y) => y.t.start - x.t.start)) {
            out = out.slice(0, t.start) + next + out.slice(t.end);
        }
        await setDisplayText(id, out);
        return true;
    }

    // ----- 선택한 글자 바로 수정 (줄 하나 안일 때) -----
    if (action === 'edit' && exact && targets.length === 1) {
        const sp = targets[0];
        const loc = await locateBest(sp.text, info.trans?.selText || info.text, info.trans?.occ ?? 0, id);
        if (loc) {
            const edited = await callGenericPopup(
                `<h3>Edit selection</h3>
                 <div style="text-align:left;opacity:.8;margin-top:8px"><b>#${id}</b> ${escapeHtml(name)} · translation only</div>`,
                POPUP_TYPE.INPUT,
                loc.shown,
                { rows: Math.min(10, Math.max(3, loc.shown.split('\n').length + 1)), okButton: 'Save', cancelButton: 'Cancel' },
            );
            if (typeof edited !== 'string' || edited === loc.shown) return true;
            if (!stillHere()) return true;
            if (!unchanged()) {
                window.toastr?.warning('The message changed; nothing was replaced.');
                return true;
            }
            await setDisplayText(id, html.slice(0, sp.start) + loc.apply(edited) + html.slice(sp.end));
            return true;
        }
        window.toastr?.info("Couldn't pinpoint the selected text, so the whole translated line is shown.");
    }

    // ----- 번역 줄 통째 편집 (태그 없이 내용만) -----
    const seed = targets.map((t) => t.text).join(SPAN_DIVIDER);
    const lines = seed.split('\n').length;
    const note = (exact ? '' : "Couldn't pinpoint the line, so every translated line is shown. ")
        + (action === 'edit' && targets.length > 1 ? 'The selection spans several lines, so whole lines are shown. ' : '')
        + (targets.length > 1 ? 'Keep the ────────── dividers as they are. ' : '')
        + 'Only the displayed translation changes; the original message is not touched.';
    const edited = await callGenericPopup(
        `<h3>Edit translated line</h3>
         <div style="text-align:left;opacity:.8;margin-top:8px"><b>#${id}</b> ${escapeHtml(name)} · ${targets.length} line(s)</div>
         <div style="text-align:left;opacity:.7;margin-top:8px;font-size:.9em">${escapeHtml(note)}</div>`,
        POPUP_TYPE.INPUT,
        seed,
        { rows: Math.min(18, Math.max(3, lines + 1)), okButton: 'Save', cancelButton: 'Cancel' },
    );
    if (typeof edited !== 'string' || edited === seed) return true;
    if (!stillHere()) return true;

    const parts = edited.split(SPAN_DIVIDER);
    if (parts.length !== targets.length) {
        window.toastr?.warning(`Divider lines were changed (expected ${targets.length} parts, got ${parts.length}). Nothing was saved.`);
        return true;
    }
    if (!unchanged()) {
        window.toastr?.warning('The message changed; nothing was replaced.');
        return true;
    }
    // 뒤에서부터 바꿔야 앞쪽 위치가 안 밀림
    let next = html;
    for (let i = targets.length - 1; i >= 0; i--) {
        next = next.slice(0, targets[i].start) + parts[i] + next.slice(targets[i].end);
    }
    await setDisplayText(id, next);
    return true;
}

// LLM 번역 확장의 "번역문 수정" 버튼(.mes_edit_translation)을 대신 눌러서 그 확장의 수정창을 띄움.
// 설정에서 그 버튼을 숨겨 놨어도(display:none) 눌러지고, 버튼이 없으면 false
function openLlmTranslatorEdit(mes) {
    const btn = mes.querySelector('.mes_edit_translation');
    if (!btn) return false;
    btn.click();   // 가짜 클릭(isTrusted=false): 아래 chatEl click 차단 로직이 막지 않도록 거기서 걸러 줌
    return true;
}

// 선택 글자 메뉴
//  1) 번역문(extra.display_text)이 없을 때
//      - 선택한 글자가 원문에 그대로 있으면 → 기존 방식(정확한 위치 수정/삭제)
//      - 없으면(마크다운·XML·정규식 등으로 화면이 달라진 경우) → <p> 문단 매칭으로 원문 문단 편집
//  2) 번역문이 있을 때
//      - Edit translation: 번역문(display_text)만 수정. mes(프롬프트)는 그대로. 글자가 안 맞으면 번역문 문단 편집
//      - Edit original: 원문(mes)을 <p> 문단 단위로만 매칭해서 편집. 짝이 안 맞으면 원문 통째 편집
async function showSelectionMenu(mes, info) {
    const id = Number(mes.getAttribute('mesid'));
    if (Number.isNaN(id) || !chat[id]) return;

    const { text } = info;
    const name = chat[id].name || '';
    const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
    const translated = hasDisplayText(id);
    const llm = translated && isLlmTranslated(id);

    // LLM 번역 확장의 "원문 보기" 토글 중이면 display_text 가 원문이라서, 지금 고쳐도 토글하면 사라짐
    if (llm && chat[id].extra?.original_translation_backup) {
        window.toastr?.warning('The original text is being shown (LLM translator toggle). Switch back to the translation first.');
        return;
    }
    if (llm) window.toastr?.info('LLM translation detected — the original text will not be touched.');

    const html = `<h3>Selected text</h3>
        <div style="text-align:left;opacity:.8;margin-top:8px">
            <b>#${id}</b> ${escapeHtml(name)}${translated ? ' · <i>translated</i>' : ''}<br>“${escapeHtml(preview)}”
        </div>`;

    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    if (!callGenericPopup || !POPUP_TYPE) return;

    const CUSTOM_EDIT = POPUP_RESULT?.CUSTOM1 ?? 1001;
    const CUSTOM_ORIG = POPUP_RESULT?.CUSTOM2 ?? 1002;
    const RESULT_CANCEL = POPUP_RESULT?.NEGATIVE ?? 0;

    // LLM 번역이 떠 있으면 원문 수정 버튼은 아예 없음 (번역문만 수정)
    const customButtons = llm
        ? [{ text: 'Edit', result: CUSTOM_EDIT }]
        : translated
            ? [{ text: 'Edit translation', result: CUSTOM_EDIT }, { text: 'Edit original', result: CUSTOM_ORIG }]
            : [{ text: 'Edit', result: CUSTOM_EDIT }];

    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: translated ? 'Delete (translation)' : 'Delete',
        cancelButton: 'Cancel',
        defaultResult: RESULT_CANCEL,
        customButtons,
    });

    let action = null;
    if (POPUP_RESULT ? result === POPUP_RESULT.AFFIRMATIVE : result === true) action = 'delete';
    else if (result === CUSTOM_EDIT) action = 'edit';
    else if (translated && !llm && result === CUSTOM_ORIG) action = 'original';
    if (!action) return;

    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    // LLM 번역 + Edit: 우리 쪽 편집창 대신 LLM 번역 확장의 "번역문 수정" 기능으로 넘김
    if (llm && action === 'edit') {
        if (openLlmTranslatorEdit(mes)) {
            window.toastr?.error('Selection edit is not available on LLM translations. Opening the translator\'s edit window instead.');
            return;
        }
        window.toastr?.warning("Couldn't find the LLM translator's edit button; trying the built-in editor.");
    }

    // LLM 번역 + 함께 보기 HTML: 번역 줄 내용만 편집창에 띄우고 display_text 의 span 안쪽만 교체
    // 1순위: 번역 확장의 DB(IndexedDB) 번역문을 직접 고치고 display_text 를 다시 만들게 함
    if (llm && await editLlmViaDB(mes, id, action, info, name)) return;
    // 2순위(DB 에서 못 찾았을 때): display_text 안의 번역 줄만 직접 고침
    if (llm && await editTranslationSpans(mes, id, action, info, name)) return;

    // 번역문이 있으면: Edit original 만 원문(mes), 나머지(Edit/Delete)는 번역문(display_text)이 대상
    const field = (translated && action !== 'original') ? 'display_text' : 'mes';
    const sourceLabel = field === 'display_text' ? 'translation' : 'message';

    // 번역문이 있을 때 원문 수정 → 글자 매칭은 하지 않고 문단 단위로만
    if (translated && action === 'original') {
        await editByParagraph(mes, id, 'mes', info, name);
        return;
    }

    // 화면 글자가 대상 텍스트에 그대로 있으면 기존 방식
    if (getField(id, field).includes(text)) {
        await editExact(mes, id, field, action, info, name, sourceLabel);
        return;
    }

    // 그대로는 없음 (마크다운/XML/정규식 등으로 화면과 저장 텍스트가 다름) → 문단 매칭 폴백
    if (action === 'delete') {
        window.toastr?.warning('Could not locate the exact text. Use Edit to change the whole paragraph instead.');
        return;
    }
    await editByParagraph(mes, id, field, info, name);
}

// (x, y) 지점에 실제 글자가 있는지 판정 (본문 블록의 빈 공간은 false)
// 본문(.mes_text) 안의 모든 텍스트 노드의 "줄 단위 사각형"과 직접 비교하므로
// 줄 오른쪽 끝의 빈 공간도 정확히 여백으로 인식됨
function isOnText(x, y, root) {
    if (!root) return false;
    const rb = root.getBoundingClientRect();
    if (x < rb.left || x > rb.right || y < rb.top || y > rb.bottom) return false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        range.selectNodeContents(n);
        for (const rc of range.getClientRects()) {
            if (rc.width === 0 || rc.height === 0) continue;
            if (x >= rc.left - TEXT_HIT_PAD_X && x <= rc.right + TEXT_HIT_PAD_X &&
                y >= rc.top - TEXT_HIT_PAD_Y && y <= rc.bottom + TEXT_HIT_PAD_Y) {
                return true;
            }
        }
    }
    return false;
}

// 이벤트 target 이 .mes 밖(메시지 사이 틈, #chat 자체 등)일 때 좌표로 메시지를 찾음
function findMesAtPoint(chatEl, x, y) {
    for (const m of chatEl.querySelectorAll(':scope > .mes')) {
        const r = m.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) return m;
    }
    return null;
}

async function showLongPressMenu(mes) {
    const id = Number(mes.getAttribute('mesid'));
    if (Number.isNaN(id) || !chat[id]) return;

    const name = chat[id].name || '';
    const { snippet } = makePreview(id);
    const folded = isFolded(id);
    const hidden = !!chat[id].is_system;   // /hide 로 숨김 처리된 메시지

    const html = `<h3>Message options</h3>
        <div style="text-align:left;opacity:.8;margin-top:8px">
            <b>#${id}</b> ${escapeHtml(name)}<br>${escapeHtml(snippet)}
        </div>`;

    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT, executeSlashCommandsWithOptions } = ctx();
    const CUSTOM_HIDE = POPUP_RESULT?.CUSTOM1 ?? 1001;
    const CUSTOM_FOLD = POPUP_RESULT?.CUSTOM2 ?? 1002;
    const RESULT_CANCEL = POPUP_RESULT?.NEGATIVE ?? 0;

    // 연동 모드: 'replace' 면 Hide/Fold 버튼을 하나로 합침, 'keep' 이면 두 버튼 그대로 (hide 시 fold 도 같이 적용)
    // comment 도 일반 메시지와 똑같이 연동 (comment 는 처음부터 is_system 이라 항상 '숨김' 상태로 취급됨)
    const mode = linkMode();
    const linked = !!mode;
    const foldButton = { text: folded ? 'Unfold' : 'Fold', result: CUSTOM_FOLD };
    const hideButton = { text: hidden ? 'Unhide' : 'Hide', result: CUSTOM_HIDE };
    let customButtons;
    if (mode === 'replace') customButtons = [{ text: hidden ? 'Unhide & Unfold' : 'Hide & Fold', result: CUSTOM_HIDE }];
    else customButtons = [hideButton, foldButton];

    let action = null; // 'delete' | 'hide' | 'fold' | null
    if (callGenericPopup && POPUP_TYPE) {
        // OK 버튼(빨간색) = Delete.
        // 버튼은 팝업 기본 배치(한 줄) 그대로 사용
        const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
            okButton: 'Delete',
            cancelButton: 'Cancel',
            defaultResult: RESULT_CANCEL,   // Enter / 기본 포커스는 Cancel (실수로 삭제 방지)
            customButtons,
        });
        if (POPUP_RESULT ? result === POPUP_RESULT.AFFIRMATIVE : result === true) action = 'delete';
        else if (result === CUSTOM_HIDE) action = 'hide';
        else if (result === CUSTOM_FOLD) action = 'fold';
    } else if (window.confirm('Delete this message?')) {
        action = 'delete';
    }
    if (!action) return;

    // 팝업 도중 채팅이 바뀌었는지 / 인덱스가 밀렸는지 확인
    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    if (action === 'fold') {
        await toggleFold(mes);
    } else if (action === 'hide') {
        // hide 는 is_system = true, unhide 는 false 로 저장됩니다.
        await executeSlashCommandsWithOptions(`/${hidden ? 'unhide' : 'hide'} ${id}`);
        if (linked && setFold(id, !hidden)) await saveChatConditional();   // 연동: hide→fold, unhide→unfold
        if (mes.isConnected) render(mes);   // 접힌 바의 유령 아이콘 갱신
    } else {
        await executeSlashCommandsWithOptions(`/cut ${id}`);
    }
}

function initLongPress(chatEl) {
    let timer = null;       // 팝업을 띄우는 타이머
    let showTimer = null;   // 테두리를 보여주기 시작하는 타이머 (터치 전용)
    let pressedMes = null;
    let startX = 0, startY = 0;
    let fired = false;
    let releaseTimer = null;   // 팝업 뜬 뒤 테두리를 잠깐 유지했다가 지우는 타이머
    let releaseMes = null;
    // 'msg' : 일반 길게 누르기
    // 'sel' : 이미 선택된 글자 위에서 길게 누르기 → 선택 메뉴
    let mode = 'msg';
    let pressTouch = false;
    let holdMs = holdTime(DEFAULTS.holdMouse, DEFAULTS.holdMouse);

    const releaseNow = () => {
        clearTimeout(releaseTimer);
        releaseTimer = null;
        if (releaseMes) {
            releaseMes.classList.remove('lpd-pressing', 'lpd-touch', 'lpd-nosel');
            releaseMes = null;
        }
    };

    const cancel = () => {
        clearTimeout(timer);
        clearTimeout(showTimer);
        timer = null;
        showTimer = null;
        if (pressedMes) {
            pressedMes.classList.remove('lpd-pressing', 'lpd-touch', 'lpd-nosel');
            pressedMes = null;
        }
    };

    const fireSelection = () => {
        const info = getSelectionInfo();
        if (!info) {
            cancel();
            return;
        }
        fired = true;
        cancel();
        window.getSelection()?.removeAllRanges();
        navigator.vibrate?.(30);
        showSelectionMenu(info.mes, info);
    };

    const fireMessage = () => {
        const target = pressedMes;
        fired = true;
        // 타이머만 정리하고, 테두리 클래스는 AFTER_POPUP_MS 뒤에 제거
        clearTimeout(timer);
        clearTimeout(showTimer);
        timer = null;
        showTimer = null;
        pressedMes = null;
        // 빨간 테두리 피드백은 터치(모바일)에서만 보여줌. 컴퓨터(마우스)에서는 표시 안 함.
        if (target && pressTouch) {
            target.classList.add('lpd-pressing');
            releaseMes = target;
            releaseTimer = setTimeout(releaseNow, AFTER_POPUP_MS);
        }
        window.getSelection()?.removeAllRanges();
        navigator.vibrate?.(30);
        if (target) showLongPressMenu(target);
    };

    const onHold = () => {
        if (mode === 'msg') {
            // 선택이 진행 중이면 팝업을 띄우지 않음 (드래그 도중에 뜨는 것 방지)
            return hasSelection() ? cancel() : fireMessage();
        }
        fireSelection();   // 'sel': 이미 선택된 글자 위를 다시 길게 누른 경우만
    };

    chatEl.addEventListener('pointerdown', (e) => {
        fired = false;
        mode = 'msg';
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!styleEnabled()) return;

        // .mes 밖(아바타 아래 빈 칸 등 래퍼/틈)을 눌러도 좌표로 메시지를 찾아 처리
        let mes = e.target.closest?.('.mes') ?? null;
        if (!mes && e.target === chatEl) mes = findMesAtPoint(chatEl, e.clientX, e.clientY);
        if (!mes || e.target.closest?.(LP_IGNORE)) return;
        if (mes.querySelector('textarea.edit_textarea')) return; // 편집 중이면 무시

        const isTouch = e.pointerType !== 'mouse';
        const inText = !!e.target.closest('.mes_text');

        // 이미 선택된 글자 위를 누른 경우 → 선택 메뉴 모드
        const selHit = inText && hasSelection() && pointOnSelection(e.clientX, e.clientY);

        // 패널에서 꺼 둔 기능은 시작하지 않음 (선택 메뉴 / 메시지 메뉴 각각)
        if (selHit ? !settings().selectionMenu : !settings().longPressMenu) return;

        // 터치 + 본문 영역: 텍스트 선택을 방해하지 않도록 길게 누르기를 시작하지 않음
        if (!selHit && isTouch && TOUCH_TEXT_SELECTABLE && inText && isOnText(e.clientX, e.clientY, e.target.closest('.mes_text'))) return;

        releaseNow();
        cancel();
        pressTouch = isTouch;
        mode = selHit ? 'sel' : 'msg';
        const st = settings();
        const touchMs = holdTime(st.holdTouch, 750);
        if (selHit) {
            // 선택한 글자 위: 터치(holdSelTouch) / 마우스(holdSelMouse) 각각 별도 설정을 사용
            holdMs = isTouch
                ? holdTime(st.holdSelTouch, DEFAULTS.holdSelTouch, SEL_HOLD_MIN)
                : holdTime(st.holdSelMouse, DEFAULTS.holdSelMouse, SEL_HOLD_MIN);
        } else {
            holdMs = isTouch ? touchMs : holdTime(st.holdMouse, DEFAULTS.holdMouse);
        }

        pressedMes = mes;
        startX = e.clientX;
        startY = e.clientY;

        // 터치 + 일반 길게 누르기: 누르고 있는 동안 이 메시지의 텍스트 선택을 막음
        // (여백/아바타 아래를 길게 누를 때 브라우저가 가까운 단어를 자동 선택해
        //  팝업보다 먼저 선택이 시작되는 것을 방지)
        if (isTouch && mode === 'msg') mes.classList.add('lpd-nosel');

        // 테두리 피드백은 터치 + 일반 길게 누르기에서만
        if (isTouch && mode === 'msg') {
            const visualMs = Math.min(VISUAL_MS, holdMs);
            mes.style.setProperty('--lpd-hold', `${visualMs}ms`);
            mes.classList.add('lpd-touch');   // iOS 콜아웃 방지 (텍스트 선택 자체는 막지 않음)
            showTimer = setTimeout(() => {
                if (pressedMes === mes) mes.classList.add('lpd-pressing');
            }, holdMs - visualMs);
        }

        timer = setTimeout(onHold, holdMs);
    });

    chatEl.addEventListener('pointermove', (e) => {
        if (!timer) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) <= MOVE_TOLERANCE) return;

        cancel();
    });
    chatEl.addEventListener('pointerup', cancel);
    ['pointercancel', 'pointerleave'].forEach((ev) => chatEl.addEventListener(ev, () => {
        // 모바일: 길게 누르는 도중 브라우저가 pointercancel 을 보내는 경우가 있어
        // (아바타 아래 빈 칸 등에서 팝업이 안 뜨던 원인) 터치는 여기서 취소하지 않음.
        // 손가락을 떼면 touchend, 움직이면 touchmove / scroll 에서 취소됨.
        if (pressTouch) return;
        cancel();
    }));
    chatEl.addEventListener('touchend', cancel, { passive: true });
    chatEl.addEventListener('touchcancel', cancel, { passive: true });
    chatEl.addEventListener('touchmove', (e) => {
        if (!timer) return;
        const t = e.touches[0];
        if (!t || Math.hypot(t.clientX - startX, t.clientY - startY) <= MOVE_TOLERANCE) return;
        cancel();
    }, { passive: true });
    chatEl.addEventListener('scroll', cancel, { passive: true });

    // (터치) 텍스트 선택이 시작되면 대기 취소
    document.addEventListener('selectionchange', () => {
        if (timer && mode === 'msg' && pressTouch && hasSelection()) cancel();
    });

    // 길게 누른 직후 발생하는 click / contextmenu 차단
    // (캡처 단계에서 막으므로 접힌 바가 임시로 펼쳐지는 일도 없음)
    chatEl.addEventListener('click', (e) => {
        if (fired && e.isTrusted) { e.preventDefault(); e.stopPropagation(); fired = false; }
    }, true);
    chatEl.addEventListener('contextmenu', (e) => {
        if (timer || fired) e.preventDefault();
    });
}

// ===================== /fold, /unfold =====================

// "3" / "2-5" / "4-" (4번부터 끝까지) → { start, end }
function parseRange(text) {
    const m = String(text ?? '').trim().match(/^(\d+)(?:\s*-\s*(\d*))?$/);
    if (!m) return null;
    const last = chat.length - 1;
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : (m[2] === '' ? last : Number(m[2]));
    if (start > end || start > last) return null;
    return { start, end: Math.min(end, last) };
}

async function foldCommand(value, fold) {
    const range = parseRange(value);
    if (!range) {
        window.toastr?.warning(`Specify a message index or range. e.g. /${fold ? 'fold' : 'unfold'} 3, 2-5, 4-`);
        return '';
    }
    let changed = false;
    for (let i = range.start; i <= range.end; i++) changed = setFold(i, fold) || changed;
    if (changed) await saveChatConditional();
    return '';
}

function registerSlashCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx();
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) {
        console.warn('[Message Fold] Slash command API not found; /fold, /unfold not registered.');
        return;
    }
    const mkArg = () => SlashCommandArgument.fromProps({
        description: 'message index or range (e.g. 3, 2-5, 4-)',
        typeList: [ARGUMENT_TYPE?.RANGE ?? 'range'],
        isRequired: true,
    });
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'fold',
        callback: (_args, value) => foldCommand(value, true),
        unnamedArgumentList: [mkArg()],
        helpString: 'Folds (collapses) a message or a range of messages. Example: <code>/fold 3</code>, <code>/fold 2-5</code>, <code>/fold 4-</code>',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'unfold',
        callback: (_args, value) => foldCommand(value, false),
        unnamedArgumentList: [mkArg()],
        helpString: 'Unfolds a message or a range of messages. Example: <code>/unfold 3</code>, <code>/unfold 2-5</code>',
    }));
}

// ===================== 확장 패널 =====================

function initSettingsPanel() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('mf-settings')) return;

    const wrap = document.createElement('div');
    wrap.id = 'mf-settings';
    wrap.className = 'mf-settings';
    wrap.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Message Fold &amp; Delete</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <fieldset class="mf-box">
                    <legend><i class="fa-solid fa-eye"></i>Hide &amp; Fold</legend>
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_link_hide_fold">
                            <span class="mf-opt-title">Link Hide &amp; Fold</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_link_hide_fold"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Hiding a message also folds it, and unhiding also unfolds it. Works with /hide, /unhide, the hide icon and the long-press popup.</small>
                        <div id="mf_link_modes" class="mf-modes">
                            <label class="mf-radio">
                                <input type="radio" name="mf_link_mode" value="keep">
                                <span><span class="mf-radio-title">Keep Fold button</span><small class="mf-desc">Fold and Unfold stay as their own buttons.</small></span>
                            </label>
                            <label class="mf-radio">
                                <input type="radio" name="mf_link_mode" value="replace">
                                <span><span class="mf-radio-title">Replace Fold button</span><small class="mf-desc">Hide and Fold merge into one "Hide &amp; Fold" button.</small></span>
                            </label>
                        </div>
                    </div>
                </fieldset>
                <fieldset class="mf-box mf-collapsible mf-collapsed">
                    <legend class="mf-toggle" tabindex="0" role="button" aria-expanded="false"><i class="fa-solid fa-bolt"></i>Auto Fold &amp; Hide<i class="fa-solid fa-chevron-right mf-chevron"></i></legend>
                    <small class="mf-desc mf-intro">Choose which messages the options below apply to. Only messages created from now on are affected. With "None", auto-fold and auto-hide are turned off.</small>
                    <div class="mf-item">
                        <div class="mf-head">Target messages</div>
                        <label class="mf-radio">
                            <input type="radio" name="mf_auto_scope" value="none">
                            <span><span class="mf-radio-title">None</span></span>
                        </label>
                        <label class="mf-radio">
                            <input type="radio" name="mf_auto_scope" value="comment">
                            <span><span class="mf-radio-title">Comments only</span><small class="mf-desc">Only new messages made by slash commands like /comment and /sendas.</small></span>
                        </label>
                        <label class="mf-radio">
                            <input type="radio" name="mf_auto_scope" value="all">
                            <span><span class="mf-radio-title">All non-user messages</span><small class="mf-desc">Also new character replies and any other message that is not yours.</small></span>
                        </label>
                        <label class="mf-radio">
                            <input type="radio" name="mf_auto_scope" value="every">
                            <span><span class="mf-radio-title">All messages</span></span>
                        </label>
                    </div>
                    <div class="mf-item mf-auto-toggle">
                        <label class="mf-opt" for="mf_auto_fold_comments">
                            <span class="mf-opt-title">Auto-fold</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_auto_fold_comments"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Folds them as soon as they appear. The bar stays tinted until you open it for the first time.</small>
                    </div>
                    <div class="mf-item mf-auto-toggle">
                        <label class="mf-opt" for="mf_auto_hide_comments">
                            <span class="mf-opt-title">Auto-hide</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_auto_hide_comments"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Hides them too, so they are left out of the prompt.</small>
                    </div>
                    <small class="mf-desc mf-hint">Click to expand: auto-fold or hide new messages.</small>
                </fieldset>
                <fieldset class="mf-box mf-compact">
                    <legend><i class="fa-solid fa-hand-pointer"></i>Delete &amp; Edit</legend>
                    <div class="mf-item">
                    <div class="mf-head" style="margin-bottom: 6px;">Activate / Inactivate</div>
                        <label class="mf-opt" for="mf_long_press_menu">
                            <span class="mf-opt-title">Long-press message menu</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_long_press_menu"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Press and hold a message to open the menu with Delete, Hide and Fold.</small>
                    </div>
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_selection_menu">
                            <span class="mf-opt-title">Selection edit &amp; delete</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_selection_menu"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Select text, then press and hold the selection to edit or delete just that part.</small>
                    </div>
                    <div class="mf-item">
                        <div class="mf-head mf-head-row">
                            <span>Hold time</span>
                            <span class="mf-head-btns">
                                <button type="button" class="mf-reset" id="mf_hold_save" title="Save current hold time" aria-label="Save current hold time"><i class="fa-solid fa-floppy-disk"></i></button>
                                <button type="button" class="mf-reset" id="mf_hold_reset" title="Reset hold time to saved value (or default)" aria-label="Reset hold time to saved value (or default)"><i class="fa-solid fa-rotate-left"></i></button>
                            </span>
                        </div>
                        <label class="mf-range">
                            <span class="mf-range-name">Mouse</span>
                            <input type="range" id="mf_hold_mouse" min="500" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_mouse_val"></span>
                        </label>
                        <label class="mf-range">
                            <span class="mf-range-name">Touch</span>
                            <input type="range" id="mf_hold_touch" min="500" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_touch_val"></span>
                        </label>
                        <small class="mf-desc">How long to press before the message popup appears. Longer values help avoid accidental popups.</small>
                    </div>
                    <div class="mf-item">
                        <div class="mf-head mf-head-row">
                            <span>Text selection hold time</span>
                            <span class="mf-head-btns">
                                <button type="button" class="mf-reset" id="mf_hold_sel_save" title="Save current text selection hold time" aria-label="Save current text selection hold time"><i class="fa-solid fa-floppy-disk"></i></button>
                                <button type="button" class="mf-reset" id="mf_hold_sel_reset" title="Reset text selection hold time to saved value (or default)" aria-label="Reset text selection hold time to saved value (or default)"><i class="fa-solid fa-rotate-left"></i></button>
                            </span>
                        </div>
                        <label class="mf-range">
                            <span class="mf-range-name">Mouse</span>
                            <input type="range" id="mf_hold_sel_mouse" min="200" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_sel_mouse_val"></span>
                        </label>
                        <label class="mf-range">
                            <span class="mf-range-name">Touch</span>
                            <input type="range" id="mf_hold_sel_touch" min="200" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_sel_touch_val"></span>
                        </label>
                        <small class="mf-desc">How long to press selected text before the Edit / Delete popup appears. Mouse: lower it to open the popup right after you drag-select and click the selection. Touch: if your device starts dragging the text first (e.g. Android), lower this.</small>
                    </div>
                </fieldset>
                <fieldset class="mf-box mf-collapsible mf-collapsed">
                    <legend class="mf-toggle" tabindex="0" role="button" aria-expanded="false"><i class="fa-solid fa-sliders"></i>Other Settings<i class="fa-solid fa-chevron-right mf-chevron"></i></legend>
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_tint_unseen">
                            <span class="mf-opt-title">Tint unread folded messages</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_tint_unseen"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Auto-folded bars get a color tint until you open them for the first time.</small>
                    </div>
                    <div class="mf-item">
                        <div class="mf-head">Close an expanded message</div>
                        <label class="mf-radio">
                            <input type="radio" name="mf_close_mode" value="outside">
                            <span><span class="mf-radio-title">Click elsewhere</span><small class="mf-desc">Clicking or tapping anywhere outside the message folds it again.</small></span>
                        </label>
                        <label class="mf-radio">
                            <input type="radio" name="mf_close_mode" value="dblclick">
                            <span><span class="mf-radio-title">Double-click the message</span><small class="mf-desc">Double-click (double-tap on mobile) the expanded message to fold it again. Clicking elsewhere does nothing.</small></span>
                        </label>
                    </div>
                    <small class="mf-desc mf-hint">Click to expand: unread tint and how to close an expanded message.</small>
                </fieldset>
            </div>
        </div>`;
    host.append(wrap);

    const modes = wrap.querySelector('#mf_link_modes');
    const syncModes = () => modes.classList.toggle('mf-disabled', !settings().linkHideFold);

    const bind = (id, key, after) => {
        const el = wrap.querySelector(`#${id}`);
        el.checked = !!settings()[key];
        el.addEventListener('change', () => {
            settings()[key] = el.checked;
            ctx().saveSettingsDebounced();
            after?.();
            scheduleRefresh();
        });
    };
    bind('mf_link_hide_fold', 'linkHideFold', syncModes);
    bind('mf_auto_fold_comments', 'autoFoldComments');
    bind('mf_auto_hide_comments', 'autoHideComments');
    bind('mf_tint_unseen', 'tintUnseen');
    bind('mf_long_press_menu', 'longPressMenu');
    bind('mf_selection_menu', 'selectionMenu');

    // 길게 누르기 시간 슬라이더: 움직이는 동안 숫자 표시, 손을 떼면 저장
    const bindRange = (id, key, fallback, min = HOLD_MIN) => {
        const el = wrap.querySelector(`#${id}`);
        const val = wrap.querySelector(`#${id}_val`);
        const show = () => { val.textContent = `${el.value} ms`; };
        el.value = holdTime(settings()[key], fallback, min);
        show();
        const save = () => {
            settings()[key] = Number(el.value);
            ctx().saveSettingsDebounced();
        };
        // 움직이는 동안에도 저장 (change 이벤트가 안 오는 환경 대비), 손을 떼면 한 번 더 저장
        el.addEventListener('input', () => { show(); save(); });
        el.addEventListener('change', save);
        return { el, show };
    };
    const holdSliders = [
        { ...bindRange('mf_hold_mouse', 'holdMouse', DEFAULTS.holdMouse), key: 'holdMouse' },
        { ...bindRange('mf_hold_touch', 'holdTouch', DEFAULTS.holdTouch), key: 'holdTouch' },
    ];

    const holdSelSliders = [
        { ...bindRange('mf_hold_sel_mouse', 'holdSelMouse', DEFAULTS.holdSelMouse, SEL_HOLD_MIN), key: 'holdSelMouse' },
        { ...bindRange('mf_hold_sel_touch', 'holdSelTouch', DEFAULTS.holdSelTouch, SEL_HOLD_MIN), key: 'holdSelTouch' },
    ];

    // 길게 누르기 시간 저장 / 초기화 (메시지용 / 선택 글자용 각각)
    //  - 저장 버튼: 현재 슬라이더 값(마우스/터치)을 savedKey 에 보관
    //  - 초기화 버튼: 저장해 둔 값이 있으면 그 값으로, 없으면 기본값으로 되돌림
    const bindHoldButtons = (saveId, resetId, sliders, savedKey, label, min) => {
        wrap.querySelector(`#${saveId}`).addEventListener('click', () => {
            const st = settings();
            st[savedKey] = {};
            for (const { el, key } of sliders) st[savedKey][key] = Number(el.value);
            ctx().saveSettingsDebounced();
            window.toastr?.success(`${label} saved.`);
        });
        wrap.querySelector(`#${resetId}`).addEventListener('click', () => {
            const st = settings();
            for (const { el, show, key } of sliders) {
                const v = holdTime(st[savedKey]?.[key], DEFAULTS[key], min);
                el.value = v;
                st[key] = v;
                show();
            }
            ctx().saveSettingsDebounced();
        });
    };
    bindHoldButtons('mf_hold_save', 'mf_hold_reset', holdSliders, 'holdSaved', 'Hold time', HOLD_MIN);
    bindHoldButtons('mf_hold_sel_save', 'mf_hold_sel_reset', holdSelSliders, 'holdSelSaved', 'Text selection hold time', SEL_HOLD_MIN);

    // 접이식 박스 (옵시디언 콜아웃처럼 기본은 접힘): 제목 또는 안내 문구를 누르면 펼침/접힘
    for (const box of wrap.querySelectorAll('.mf-collapsible')) {
        const head = box.querySelector('.mf-toggle');
        const toggle = () => {
            const collapsed = box.classList.toggle('mf-collapsed');
            head.setAttribute('aria-expanded', String(!collapsed));
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            toggle();
        });
        box.querySelector('.mf-hint')?.addEventListener('click', toggle);
    }

    // 라디오 묶음 공통 처리
    const bindRadios = (name, key) => {
        for (const r of wrap.querySelectorAll(`input[name="${name}"]`)) {
            r.checked = r.value === settings()[key];
            r.addEventListener('change', () => {
                if (!r.checked) return;
                settings()[key] = r.value;
                ctx().saveSettingsDebounced();
                scheduleRefresh();
            });
        }
    };
    bindRadios('mf_close_mode', 'closeMode');

    // 대상이 'none' 이면 Auto-fold / Auto-hide 토글을 끄고 클릭도 막음
    const syncAutoToggles = () => {
        const none = settings().autoScope === 'none';
        for (const id of ['mf_auto_fold_comments', 'mf_auto_hide_comments']) {
            const el = wrap.querySelector(`#${id}`);
            el.checked = !!settings()[id === 'mf_auto_fold_comments' ? 'autoFoldComments' : 'autoHideComments'];
            el.disabled = none;
            el.closest('.mf-auto-toggle').classList.toggle('mf-disabled', none);
        }
    };
    for (const r of wrap.querySelectorAll('input[name="mf_auto_scope"]')) {
        r.checked = r.value === settings().autoScope;
        r.addEventListener('change', () => {
            if (!r.checked) return;
            const st = settings();
            st.autoScope = r.value;
            if (r.value === 'none') {
                st.autoFoldComments = false;
                st.autoHideComments = false;
            }
            ctx().saveSettingsDebounced();
            syncAutoToggles();
            scheduleRefresh();
        });
    }
    syncAutoToggles();

    // Fold 버튼 유지 / 대체 (라디오)
    const current = settings().linkMode === 'keep' ? 'keep' : 'replace';
    for (const r of wrap.querySelectorAll('input[name="mf_link_mode"]')) {
        r.checked = r.value === current;
        r.addEventListener('change', () => {
            if (!r.checked) return;
            settings().linkMode = r.value;
            ctx().saveSettingsDebounced();
            scheduleRefresh();
        });
    }
    syncModes();
}

jQuery(() => {
    initSettingsPanel();
    registerSlashCommands();

    const chatEl = document.getElementById('chat');
    if (!chatEl) return;

    document.addEventListener('click', onDocumentClick);

    chatEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const t = e.target.closest?.(`${FOLD_BTN_SELECTOR}, .mf-placeholder`);
        if (!t) return;
        e.preventDefault();
        const mes = t.closest('.mes');
        if (!mes) return;
        if (t.matches(FOLD_BTN_SELECTOR)) toggleFold(mes);
        else openTemp(mes);
    });

    new MutationObserver(scheduleRefresh).observe(chatEl, { childList: true });

    // Hide & Fold 연동: SillyTavern 이 hide/unhide 할 때 바꾸는 .mes 의 is_system 속성을 감시
    // (/hide, /unhide, 기본 hide 아이콘, 이 확장의 팝업 모두 여기서 잡힘)
    new MutationObserver((records) => {
        if (!settings().linkHideFold) return;
        let changed = false;
        for (const r of records) {
            const mes = r.target;
            if (!(mes instanceof Element) || !mes.matches('.mes')) continue;
            const now = mes.getAttribute('is_system');
            // oldValue 가 null 이면 새로 렌더된 메시지(속성이 처음 생김)라서 무시 → 새 comment 가 저절로 접히는 것 방지
            if (now === r.oldValue || r.oldValue === null) continue;
            const id = Number(mes.getAttribute('mesid'));
            if (Number.isNaN(id) || !chat[id]) continue;
            changed = setFold(id, now === 'true') || changed;
        }
        if (changed) saveChatConditional();
    }).observe(chatEl, { subtree: true, attributes: true, attributeFilter: ['is_system'], attributeOldValue: true });

    // 채팅이 바뀌거나 메시지가 삭제되면 id 가 달라질 수 있으므로 임시 펼침 상태 초기화
    // 자동 접기/숨기기 기준선: 채팅을 열 때 기존 메시지 수로 갱신, 삭제로 줄어들면 같이 낮춤
    // 클로드가 달아준 주석들 왠지 지우면 안 될 것 같군 ㅋㅋ 너도 내 주석 지우지 마 클로드야 
    syncBaseline();
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, syncBaseline);
    if (event_types.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => { autoBaseline = Math.min(autoBaseline, chat.length); });

    ['CHAT_CHANGED', 'MESSAGE_DELETED'].forEach((name) => {
        if (event_types[name]) eventSource.on(event_types[name], () => { openId = null; });
    });

    [
        'CHAT_CHANGED',
        'CHARACTER_MESSAGE_RENDERED',
        'USER_MESSAGE_RENDERED',
        'MESSAGE_UPDATED',
        'MESSAGE_EDITED',
        'MESSAGE_SWIPED',
        'MESSAGE_DELETED',
        'MORE_MESSAGES_LOADED',
    ].forEach((name) => {
        if (event_types[name]) eventSource.on(event_types[name], scheduleRefresh);
    });

    initLongPress(chatEl);

    scheduleRefresh();
});
