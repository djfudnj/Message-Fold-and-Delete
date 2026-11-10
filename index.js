// Message Fold (Persistent) + Long Press Menu
// 구현 메모 (정리/성능):
//  - 모든 DOM 리스너는 AbortController 하나로, 옵저버/이벤트 구독/타이머는 disposer 목록으로 묶어서
//    destroy() 한 번에 해제됩니다. (확장이 다시 로드돼도 이전 인스턴스를 먼저 정리)
//  - 갱신은 requestAnimationFrame 으로 한 프레임에 모아서 처리하고, 바뀐 메시지만 다시 그립니다. (전체 갱신은 채팅 전환/삭제 등 꼭 필요할 때만)
//  - DOM 쓰기(클래스/스타일)와 레이아웃 읽기(getBoundingClientRect 등)가 섞이지 않게 하고,
//    자주 호출되는 곳(settings, 미리보기 만들기, 좌표로 메시지 찾기)의 불필요한 비용을 줄였습니다.
//  - fold/unfold 아이콘의 표시/숨김은 JS 가 메시지마다 style 을 쓰지 않고, #chat 의 클래스 하나(mf-replace)와
//    메시지의 mf-pinned 클래스를 보고 style.css 가 결정합니다.

import { chat, eventSource, event_types, saveChatConditional, updateMessageBlock } from '../../../../script.js';

const KEY = 'folded';
const UNSEEN_KEY = 'mf_unseen';   // 자동 접힘 후 아직 바를 클릭하지 않은 상태 (색 덧입힘용). 바를 누르면 삭제됨
const AUTO_HIDE_KEY = 'mf_auto_hide'; // 자동 숨기기를 이미 처리한 메시지 (직접 unhide 한 뒤 다시 숨겨지는 것 방지)
const AUTO_KEY = 'mf_auto';       // 자동 접기를 이미 한 번 처리한 메시지 (수동으로 펼친 뒤 다시 접히는 것 방지)
const COMMENT_TYPE = 'comment';   // /comment 등으로 만든 메시지의 extra.type 값

// ===== 정리(cleanup) 관리 =====
let disposers = [];
const onDispose = (fn) => { disposers.push(fn); };
let ac = null;        // 모든 DOM 리스너가 공유하는 AbortController
let chatEl = null;    // #chat (init 에서 한 번만 찾아서 재사용)

function destroy() {
    ac?.abort();
    ac = null;
    const list = disposers;
    disposers = [];
    for (const fn of list.reverse()) {
        try { fn(); } catch (e) { console.warn('[Message Fold] dispose failed', e); }
    }
    chatEl = null;
    openId = null;
}

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
    batchFold: false, 
    longPressMenu: true,    // 메시지 길게 누르기 팝업 (Delete / Hide / Fold) 사용
    selectionMenu: true,    // 글자 선택 후 길게 누르기 팝업 (Edit / Delete selection) 사용
    popupDelete: true,      // 길게 누르기 팝업에 Delete 버튼 표시
    popupEdit: false,       // 길게 누르기 팝업에 Edit 버튼 표시 (메시지 전체 편집)
    popupHide: true,        // 길게 누르기 팝업에 Hide / Unhide 버튼 표시
    popupFold: true,  
    popupSwipe: true, 
    holdMouse: 610,         // 마우스 길게 누르기 시간(ms)
    holdTouch: 750,         // 터치(모바일) 길게 누르기 시간(ms)
    holdSelTouch: 600,      // 선택한 글자 위 길게 누르기 시간 - 터치(ms)
    holdSelMouse: 200,      // 선택한 글자 위 길게? 누르기 시간 - 마우스(ms)
    holdSaved: null,        // 터치랑 마우스 저장
    holdSelSaved: null,     // 텍스트 선택 (터치 + 마우스) 저장
};

let settingsRoot = null;
const settingsReady = new WeakSet();
function settings() {
    settingsRoot ??= SillyTavern.getContext().extensionSettings;
    const st = (settingsRoot[MODULE] ??= {});
    if (!settingsReady.has(st)) {
        for (const [k, v] of Object.entries(DEFAULTS)) st[k] ??= v;
        // 대상이 'none' 이면 자동 접기/숨기기는 항상 꺼진 상태로 유지
        if (st.autoScope === 'none') {
            st.autoFoldComments = false;
            st.autoHideComments = false;
        }
        settingsReady.add(st);
    }
    return st;
}

// Hide & Fold 연동 모드: null(끔) | 'keep'(Fold 버튼 유지) | 'replace'(Fold 버튼을 Hide 에 합침)
function linkMode(st = settings()) {
    if (!st.linkHideFold) return null;
    return st.linkMode === 'keep' ? 'keep' : 'replace';
}

const isComment = (msg) => msg?.extra?.type === COMMENT_TYPE;

// 슬래시 명령어로 만들어진 메시지 (/sendas, /comment, /sys 등): extra.model 이 'slash command'
// 일반 생성 메시지는 extra.model 에 실제 모델명이 들어가고, 유저 메시지는 제외
const SLASH_MODEL = 'slash command';
const isSlashMade = (msg) => !!msg && !msg.is_user && !!msg.extra
    && (msg.extra.model === SLASH_MODEL || isComment(msg));

// 자동 접기/숨기기 대상
let autoBaseline = Infinity;
const syncBaseline = () => { autoBaseline = chat.length; };
const isAutoTarget = (msg, id, scope) => {
    if (!msg || id < autoBaseline) return false;
    switch (scope) {
        case 'every': return true;             // 유저 메시지 포함 전부
        case 'all': return !msg.is_user;       // 유저가 아닌 모든 메시지
        case 'comment': return isSlashMade(msg); // 슬래시 명령어 메시지만
        default: return false;                 // 'none'
    }
};

// 상태에 따라 번갈아 나오는 두 개의 버튼 (message hide/unhide 처럼 서로 다른 버튼이 같은 자리에서 교체)
const ICON_SET = 'fa-compress';
const ICON_UNSET = 'fa-expand';
const TITLE_SET = 'Fold message';
const TITLE_UNSET = 'Unfold message';
const FOLD_BTN_SELECTOR = '.mes_fold, .mes_unfold';

// ===== 길게 누르기 설정 =====

const HOLD_MIN = 400;
const SEL_HOLD_MIN = 200;
const SEL_HOLD_MIN_MOUSE = 10;   // 마우스는 드래그 직후 바로 클릭해도 뜨도록 더 낮게 허용
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

// id 로 메시지 DOM 찾기 (#chat 안에서만 검색)
const mesById = (id) => chatEl?.querySelector(`.mes[mesid="${id}"]`) ?? null;

// 접힌 바에 보일 한 줄 미리보기. 긴 메시지 전체에 정규식을 돌리지 않도록 앞부분만 잘라서 처리
const PREVIEW_SCAN = 2000;
function makePreview(id) {
    const msg = chat[id];
    const raw = String(msg?.mes ?? '').slice(0, PREVIEW_SCAN)
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

// 메시지 하나의 접힘 표시를 갱신. 클래스 토글이 전부라서 매우 가볍다. (쓰기만 하고 레이아웃은 읽지 않음)
function render(mes, st = settings()) {
    const id = Number(mes.getAttribute('mesid'));
    const folded = isFolded(id);                 // 저장된 접힘 상태
    const collapsed = folded && openId !== id;   // 실제로 접혀 보이는지 (임시로 펼친 경우 제외)

    const unseen = st.tintUnseen && folded && !!chat[id]?.extra?.[UNSEEN_KEY];   // 자동 접힘 후 아직 안 눌러본 상태 (색 덧입힘 설정이 켜져 있을 때만)

    mes.classList.toggle('mf-folded', collapsed);
    mes.classList.toggle('mf-pinned', folded);
    mes.classList.toggle('mf-unseen', collapsed && unseen);

    // 액션 아이콘(fold / unfold)은 두 버튼 중 하나만 보이는데, 그 규칙은 style.css 가 처리:
    //  mf-pinned(저장된 접힘) 여부와 #chat.mf-replace(Fold 버튼 대체 모드)만 보고 결정

    // 접힌 메시지만 바 내용을 준비 (보이고 숨기는 건 CSS 가 .mf-folded 로 처리)
    if (folded) {
        const ph = mes.querySelector('.mf-placeholder');
        if (ph) ensureBar(ph, id);
    }
}

// id 로 메시지를 찾아 그 메시지만 갱신
function renderById(id) {
    if (id === null || id === undefined) return;
    const mes = mesById(id);
    if (mes) render(mes);
}

function decorate(mes, st = settings()) {
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

    // 예전 버전이 남긴 흔적 정리: 번갈아 바뀌던 단일 버튼의 아이콘 클래스, 인라인 display(CSS 규칙을 덮어쓰므로 제거)
    if (foldBtn) {
        foldBtn.classList.remove(ICON_UNSET);
        foldBtn.classList.add(ICON_SET);
        if (foldBtn.title !== TITLE_SET) foldBtn.title = TITLE_SET;
    }
    for (const b of mes.querySelectorAll(FOLD_BTN_SELECTOR)) if (b.style.display) b.style.display = '';

    // 접혔을 때 메시지를 대신할 한 줄 바 (.mes_block 안 -> 기존 메시지 블록과 폭 동일)
    if (!mes.querySelector('.mf-placeholder')) {
        const ph = document.createElement('div');
        ph.className = 'mf-placeholder';
        ph.title = 'Click to expand temporarily';
        ph.tabIndex = 0;
        (mes.querySelector('.mes_block') ?? mes).append(ph);
    }

    render(mes, st);
}

// 슬래시 명령어로 만든 메시지(/comment, /sendas 등)를 자동으로 접고 / 숨김 (메시지마다 각각 딱 한 번만)
// 기준선(autoBaseline) 이후 메시지만 훑고, 이번에 바뀐 메시지 id 목록을 돌려줌 (그 메시지만 다시 그리기 위해)
function autoProcessComments(st) {
    const touched = [];
    if (st.autoScope === 'none') return touched;
    if (!st.autoFoldComments && !st.autoHideComments) return touched;

    let changed = false;
    const toHide = [];
    for (let id = autoBaseline; id < chat.length; id++) {
        const msg = chat[id];
        if (!isAutoTarget(msg, id, st.autoScope)) continue;
        msg.extra ??= {};
        if (st.autoFoldComments && !msg.extra[AUTO_KEY]) {
            msg.extra[AUTO_KEY] = true;
            msg.extra[KEY] = true;
            msg.extra[UNSEEN_KEY] = true;
            changed = true;
            touched.push(id);
        }
        if (st.autoHideComments && !msg.extra[AUTO_HIDE_KEY]) {
            msg.extra[AUTO_HIDE_KEY] = true;
            changed = true;
            if (!msg.is_system) toHide.push(id);   // (comment 는 원래 is_system 이라 /hide 가 필요 없음)
            else if (st.linkHideFold && !isFolded(id)) setFold(id, true);   // 이미 숨김 상태인 comment 도 연동이 켜져 있으면 같이 접음
        }
    }
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
    return touched;
}

// 설정에 따라 #chat 에 붙는 클래스 (실제 모양 규칙은 style.css 가 처리)
//  - mf-replace : Hide & Fold 연동 + Fold 버튼 대체 모드 → 별도 fold/unfold 아이콘을 숨김
function syncChatClasses(st = settings()) {
    if (!chatEl) return;
    chatEl.classList.toggle('mf-replace', linkMode(st) === 'replace');
}

// ===== 갱신 스케줄러 =====
// 요청을 한 프레임에 모아서 처리한다.
//  - scheduleRefresh()          : 전체 갱신 (채팅 전환, 삭제로 id 가 밀린 경우, 설정 변경)
//  - scheduleRefresh(숫자 id)   : 그 메시지만
//  - scheduleRefresh(Element)   : 그 .mes 요소만 (새로 추가된 메시지)
let rafId = 0;
let needFull = false;
let dirtyIds = new Set();
let dirtyEls = new Set();

function scheduleRefresh(target) {
    if (target instanceof Element) dirtyEls.add(target);
    else if (Number.isInteger(target)) dirtyIds.add(target);
    else needFull = true;   // undefined 이거나 id 가 아닌 인자(CHAT_CHANGED 의 채팅 이름 등)
    if (rafId) return;
    rafId = requestAnimationFrame(flushRefresh);
}

function flushRefresh() {
    rafId = 0;
    if (!chatEl) return;

    const full = needFull, ids = dirtyIds, els = dirtyEls;
    needFull = false;
    dirtyIds = new Set();
    dirtyEls = new Set();

    const st = settings();   // 메시지마다 읽지 않고 한 번만 읽어서 전달
    syncChatClasses(st);     // 설정이 바뀌어도 #chat 클래스 하나만 갱신하면 됨
    const touched = autoProcessComments(st);

    if (full) {
        for (const mes of chatEl.querySelectorAll('.mes')) decorate(mes, st);
        return;
    }
    for (const id of touched) ids.add(id);
    for (const id of ids) {
        const mes = mesById(id);
        if (mes) els.add(mes);
    }
    for (const mes of els) if (mes.isConnected) decorate(mes, st);
}

// 데이터(저장 상태)만 바꿈. 화면은 건드리지 않음. 실제로 바뀌었으면 true
function setFoldData(id, value) {
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
    return true;
}

// 데이터 변경 + 그 메시지 하나만 바로 화면 갱신 (저장 호출은 호출한 쪽에서). 실제로 바뀌었으면 true
function setFold(id, value) {
    const changed = setFoldData(id, value);
    if (changed) renderById(id);
    return changed;
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
    const openMes = mesById(openId);
    if (openMes?.querySelector('#curEditTextarea')) return;

    // 다른 챗 / 빈 곳 → 다시 접기
    closeTemp();
}

// ===================== Long Press Menu =====================

const ctx = () => SillyTavern.getContext();

const escapeHtml = (t) => t.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// 선택 여부 확인. Selection.toString() 은 레이아웃을 계산하므로 쓰지 않고,
// 레이아웃이 필요 없는 Range.toString() 으로 확인한다.
const hasSelection = () => {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.getRangeAt(0).toString().length > 0;
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
    const preStr = pre.toString();
    const startOffset = preStr.length + lead;
    const full = a.textContent;
    let occurrence = 0;
    for (let i = full.indexOf(text); i !== -1 && i < startOffset; i = full.indexOf(text, i + 1)) occurrence++;

    // 공백을 모두 뺀 기준으로 같은 글자가 앞에 몇 번 있었는지 (여러 문단에 걸친 선택은 문단 사이 줄바꿈이
    // 화면 글자(range.toString)와 저장 텍스트에서 서로 달라서, 공백을 무시하고 위치를 찾기 위함)
    const squash = (t) => t.replace(/\s+/g, '');
    const fullC = squash(full), textC = squash(text), preC = squash(preStr).length;
    let occurrenceC = 0;
    for (let i = textC ? fullC.indexOf(textC) : -1; i !== -1 && i < preC; i = fullC.indexOf(textC, i + 1)) occurrenceC++;

    // 선택이 걸친 <p> 들의 범위 (여러 문단에 걸쳐도 됨). 경계에 닿기만 하고 글자가 안 걸린 문단은 제외
    // (Range 하나를 재사용해서 문단 수만큼 만들지 않음)
    const ps = paraList(a);
    const r = document.createRange();
    const hasText = (p) => {
        r.selectNodeContents(p);
        if (p.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
        if (p.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
        return r.toString().trim() !== '';
    };
    const hit = [];
    for (let i = 0; i < ps.length; i++) {
        if (range.intersectsNode(ps[i]) && hasText(ps[i])) hit.push({ p: ps[i], i });
    }
    const para = hit.length
        ? {
            index: hit[0].i,
            last: hit[hit.length - 1].i,
            count: ps.length,
            text: hit.map((h) => h.p.textContent.trim()).join('\n\n'),
        }
        : null;

    return { mes, text, occurrence, occurrenceC, para };
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

// 공백(줄바꿈 포함) 차이를 무시하고 찾기: 여러 문단을 걸쳐 선택하면 화면 글자에는 문단 사이 줄바꿈이 없고
// 저장 텍스트에는 "\n\n" 이 있어서 그대로는 못 찾기 때문. 찾으면 저장 텍스트 쪽의 실제 구간을 돌려줌
function findInRawLoose(raw, text, occurrence) {
    const want = text.replace(/\s+/g, '');
    if (!want) return null;
    const chars = [], map = [];
    for (let i = 0; i < raw.length; i++) {
        if (/\s/.test(raw[i])) continue;
        chars.push(raw[i]);
        map.push(i);
    }
    const squashed = chars.join('');
    const idx = [];
    for (let i = squashed.indexOf(want); i !== -1; i = squashed.indexOf(want, i + 1)) idx.push(i);
    if (!idx.length) return null;
    const st = idx[occurrence] ?? (idx.length === 1 ? idx[0] : undefined);
    if (st === undefined) return null;
    return { start: map[st], end: map[st + want.length - 1] + 1 };
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
async function setMessageText(id, next) {
    const msg = chat[id];
    if (!msg) return;
    msg.mes = next;
    if (Array.isArray(msg.swipes) && Number.isInteger(msg.swipe_id) && msg.swipes[msg.swipe_id] !== undefined) {
        msg.swipes[msg.swipe_id] = next;
    }
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
let _fmtTried = false;
async function getFormatter() {
    if (_fmt || _fmtTried) return _fmt;
    _fmtTried = true;
    try {
        // 정적 import 로 두면 messageFormatting 이 없는 버전에서 확장 전체가 로드 실패하므로 동적 import
        const mod = await import('../../../../script.js');
        if (typeof mod.messageFormatting === 'function') _fmt = mod.messageFormatting;
    } catch (e) {
        console.warn('[message-fold] messageFormatting unavailable', e);
    }
    return _fmt;
}

// 문단 수를 셀 때 쓰는 파서 (매번 새로 만들지 않고 재사용)
const domParser = new DOMParser();

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
        const doc = domParser.parseFromString(String(html), 'text/html');   // 비활성 문서: 이미지 로드/스크립트 실행 없음
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

// 저장 텍스트에서 블록 하나를 지우고, 남는 빈 줄이 겹치지 않게 정리
function cutBlock(val, start, end) {
    let left = val.slice(0, start);
    let right = val.slice(end).replace(/^\n+/, '');
    if (!right) left = left.replace(/\s+$/, '');
    return left + right;
}

// 번역문에서 선택한 글자의 위치를 찾음 (정확히 일치 → 공백/줄바꿈만 다른 경우 순서). 못 찾으면 null
function locateInTranslation(id, info) {
    const raw = getField(id, 'display_text');
    if (raw.includes(info.text)) {
        const loc = findInRaw(raw, info.text, info.occurrence);
        if (loc) return { raw, start: loc.start, end: loc.end };
    }
    const loose = findInRawLoose(raw, info.text, info.occurrenceC ?? 0);
    return loose ? { raw, start: loose.start, end: loose.end } : null;
}

// 번역문이 있을 때 Delete: 선택한 번역문 + 그에 대응하는 원문(mes) 문단을 함께 삭제
async function deleteBoth(mes, id, info) {
    // 1) 먼저 둘 다 위치를 확인 (번역문을 못 찾으면 아무것도 지우지 않음)
    const tr = locateInTranslation(id, info);
    if (!tr) {
        window.toastr?.warning('Could not locate the selected text in the translation. Nothing was deleted.');
        return;
    }
    const orig = await mapParagraph(id, 'mes', info.para);
    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    // 2) 원문 먼저 삭제 (MESSAGE_EDITED 가 번역 확장을 건드려도 번역문 수정이 마지막에 적용되게)
    let origDone = false;
    if (orig) {
        const cur = getField(id, 'mes');
        if (cur.slice(orig.start, orig.end) === orig.text) {
            await setMessageText(id, cutBlock(cur, orig.start, orig.end));
            origDone = true;
        }
    }

    // 3) 번역문에서 선택한 글자 삭제
    const trNow = getField(id, 'display_text');
    if (trNow === tr.raw) {
        await setDisplayText(id, tr.raw.slice(0, tr.start) + tr.raw.slice(tr.end));
    } else {
        window.toastr?.warning('The translation changed; it was not modified.');
        return;
    }

    if (!origDone) {
        window.toastr?.warning("Couldn't match the original paragraph, so only the translation was deleted.");
    }
}

const QUOTE_MAX = 50;   // 편집창 안내문에 인용하는 선택 글자 최대 길이

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
    // 내가 선택했던 글자를 통째로 인용 (문단 구분 없이 한 덩어리). 50자를 넘으면 뒤는 …
    const qFlat = info.text.replace(/\s+/g, ' ').trim();
    const qText = qFlat.length > QUOTE_MAX ? qFlat.slice(0, QUOTE_MAX) + '…' : qFlat;
    const notice = `<div style="text-align:left;opacity:.7;margin-top:8px;font-size:.9em">`
        + `Couldn't match your selection exactly, so the whole ${map ? 'paragraph' + (map.last > map.index ? 's' : '') : 'message'} is shown below.`
        + `<br><br>Your selection:<br>“${escapeHtml(qText)}”</div>`;

    const edited = await callGenericPopup(
        `<h3>Edit ${fieldLabel}</h3>
         <div style="text-align:left;opacity:.8;margin-top:8px"><b>#${id}</b> ${escapeHtml(name)} · ${scope}</div>${notice}`,
        POPUP_TYPE.INPUT,
        seed,
        {
            rows: map ? Math.min(16, 6 + 3 * (map.last - map.index)) : 16,
            okButton: 'Save',
            cancelButton: 'Cancel',
        },
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
                // 체크박스는 팝업 DOM 과 함께 사라지므로 따로 해제할 필요 없음
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

    const html = `<h3>Selected text</h3><span class="mf-popup-marker"></span>
        <div style="text-align:left;opacity:.8;margin-top:8px">
            <b>#${id}</b> ${escapeHtml(name)}${translated ? ' · <i>translated</i>' : ''}<br>“${escapeHtml(preview)}”
        </div>${translated ? '<div style="text-align:left;opacity:.6;margin-top:8px;font-size:.85em">Delete removes the selected translation and the matching original paragraph.</div>' : ''}`;

    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    if (!callGenericPopup || !POPUP_TYPE) return;

    const CUSTOM_EDIT = POPUP_RESULT?.CUSTOM1 ?? 1001;
    const CUSTOM_ORIG = POPUP_RESULT?.CUSTOM2 ?? 1002;
    const RESULT_CANCEL = POPUP_RESULT?.NEGATIVE ?? 0;

    const customButtons = translated
        ? [{ text: 'Edit translation', result: CUSTOM_EDIT }, { text: 'Edit original', result: CUSTOM_ORIG }]
        : [{ text: 'Edit', result: CUSTOM_EDIT }];

    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: translated ? 'Delete (both)' : 'Delete',
        cancelButton: 'Cancel',
        defaultResult: RESULT_CANCEL,
        customButtons,
    });

    let action = null;
    if (POPUP_RESULT ? result === POPUP_RESULT.AFFIRMATIVE : result === true) action = 'delete';
    else if (result === CUSTOM_EDIT) action = 'edit';
    else if (translated && result === CUSTOM_ORIG) action = 'original';
    if (!action) return;

    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    // 번역문이 있을 때 Delete: 번역문 + 대응하는 원문 문단을 함께 삭제
    if (translated && action === 'delete') {
        await deleteBoth(mes, id, info);
        return;
    }

    // 번역문이 있으면: Edit original 만 원문(mes), Edit 은 번역문(display_text)이 대상
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

    // 줄바꿈/공백만 다른 경우(여러 문단에 걸친 선택): 저장 텍스트의 실제 구간을 찾아 그 부분만 편집
    {
        const raw = getField(id, field);
        const loose = findInRawLoose(raw, text, info.occurrenceC ?? 0);
        if (loose) {
            const exact = raw.slice(loose.start, loose.end);
            let occ = 0;
            for (let i = raw.indexOf(exact); i !== -1 && i < loose.start; i = raw.indexOf(exact, i + 1)) occ++;
            await editExact(mes, id, field, action, { ...info, text: exact, occurrence: occ }, name, sourceLabel);
            return;
        }
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
// (읽기 전용 함수라 레이아웃을 무효화하지 않고, Range 는 하나만 재사용)
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
// 메시지는 위에서 아래로 정렬돼 있으므로 이진 탐색(O(log n))으로 먼저 찾고,
// 순서가 깨진 특수한 경우에만 기존처럼 전부 훑는다.
function findMesAtPoint(root, x, y) {
    const kids = root.children;
    let lo = 0, hi = kids.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = kids[mid].getBoundingClientRect();
        if (y < r.top) hi = mid - 1;
        else if (y > r.bottom) lo = mid + 1;
        else if (kids[mid].matches('.mes') && x >= r.left && x <= r.right) return kids[mid];
        else break;
    }
    for (const m of root.querySelectorAll(':scope > .mes')) {
        const r = m.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) return m;
    }
    return null;
}

// 현재 보이는 스와이프 하나만 삭제 (메시지는 남김). 스와이프가 1개뿐이면 아무것도 하지 않음
// 접기 상태(extra 의 fold 관련 키)는 스와이프 전환으로 extra 가 바뀌어도 유지
async function deleteCurrentSwipe(id) {
    const msg = chat[id];
    const swipes = msg?.swipes;
    if (!Array.isArray(swipes) || swipes.length <= 1) return false;

    const cur = Number.isInteger(msg.swipe_id) ? msg.swipe_id : 0;
    const keep = {};
    for (const k of [KEY, UNSEEN_KEY, AUTO_KEY, AUTO_HIDE_KEY]) if (msg.extra?.[k] !== undefined) keep[k] = msg.extra[k];

    swipes.splice(cur, 1);
    if (Array.isArray(msg.swipe_info)) msg.swipe_info.splice(cur, 1);

    const next = Math.min(cur, swipes.length - 1);
    msg.swipe_id = next;
    msg.mes = swipes[next];
    const info = Array.isArray(msg.swipe_info) ? msg.swipe_info[next] : null;
    if (info) {
        msg.extra = structuredClone(info.extra ?? {});
        if (info.send_date !== undefined) msg.send_date = info.send_date;
        if (info.gen_started !== undefined) msg.gen_started = info.gen_started;
        if (info.gen_finished !== undefined) msg.gen_finished = info.gen_finished;
    }
    msg.extra ??= {};
    Object.assign(msg.extra, keep);

    updateMessageBlock(id, msg);
    const mesEl = mesById(id);
    const counter = mesEl?.querySelector('.swipes-counter');
    if (counter) counter.textContent = `${next + 1}\u200b/\u200b${swipes.length}`;

    if (event_types.MESSAGE_SWIPE_DELETED) {
        await eventSource.emit(event_types.MESSAGE_SWIPE_DELETED, { messageId: id, swipeId: cur, newSwipeId: next });
    }
    await eventSource.emit(event_types.MESSAGE_UPDATED, id);
    await saveChatConditional();
    return true;
}

async function showLongPressMenu(mes) {
    const id = Number(mes.getAttribute('mesid'));
    if (Number.isNaN(id) || !chat[id]) return;

    const name = chat[id].name || '';
    const { snippet } = makePreview(id);
    const folded = isFolded(id);
    const hidden = !!chat[id].is_system;   // /hide 로 숨김 처리된 메시지

    const pstHtml = settings();
    const html = `<h3>Message options</h3><span class="mf-popup-marker${pstHtml.popupDelete ? '' : ' mf-no-delete'}"></span>
        <div style="text-align:left;opacity:.8;margin-top:8px">
            <b>#${id}</b> ${escapeHtml(name)}<br>${escapeHtml(snippet)}
        </div>`;

    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT, executeSlashCommandsWithOptions } = ctx();
    const CUSTOM_HIDE = POPUP_RESULT?.CUSTOM1 ?? 1001;
    const CUSTOM_FOLD = POPUP_RESULT?.CUSTOM2 ?? 1002;
    const CUSTOM_SWIPE = POPUP_RESULT?.CUSTOM3 ?? 1003;
    const CUSTOM_EDIT = POPUP_RESULT?.CUSTOM4 ?? 1004;
    const RESULT_CANCEL = POPUP_RESULT?.NEGATIVE ?? 0;
    const pst = settings();
    const swipeCount = Array.isArray(chat[id].swipes) ? chat[id].swipes.length : 0;

    // 연동 모드: 'replace' 면 Hide/Fold 버튼을 하나로 합침, 'keep' 이면 두 버튼 그대로 (hide 시 fold 도 같이 적용)
    // comment 도 일반 메시지와 똑같이 연동 (comment 는 처음부터 is_system 이라 항상 '숨김' 상태로 취급됨)
    const mode = linkMode();
    const linked = !!mode;
    const foldButton = { text: folded ? 'Unfold' : 'Fold', result: CUSTOM_FOLD };
    const hideButton = { text: hidden ? 'Unhide' : 'Hide', result: CUSTOM_HIDE };
    let customButtons = [];
    if (pst.popupEdit) customButtons.push({ text: 'Edit', result: CUSTOM_EDIT });
    if (mode === 'replace') {
        if (pst.popupHide) customButtons.push({ text: hidden ? 'Unhide & Unfold' : 'Hide & Fold', result: CUSTOM_HIDE });
    } else {
        if (pst.popupHide) customButtons.push(hideButton);
        if (pst.popupFold) customButtons.push(foldButton);
    }
    // 스와이프가 2개 이상일 때만 (하나뿐이면 메시지 삭제와 같으므로)
    if (pst.popupSwipe && swipeCount > 1) {
        // Delete(OK 버튼)와 같은 빨간색 경고 스타일
        customButtons.push({ text: 'Delete swipe', result: CUSTOM_SWIPE, classes: ['redWarningBG'] });
    }

    let action = null; // 'delete' | 'hide' | 'fold' | 'swipe' | null
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
        else if (result === CUSTOM_SWIPE) action = 'swipe';
        else if (result === CUSTOM_EDIT) action = 'edit';
    } else if (window.confirm('Delete this message?')) {
        action = 'delete';
    }
    if (!action) return;

    // 팝업 도중 채팅이 바뀌었는지 / 인덱스가 밀렸는지 확인
    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    if (action === 'fold') {
        await toggleFold(mes);
    } else if (action === 'edit') {
        // 접힌 메시지는 임시로 펼친 뒤, ST 기본 편집 버튼을 눌러 편집 모드로 진입
        if (isFolded(id) && openId !== id) {
            const prev = openId;
            openId = id;
            renderById(prev);
            render(mes);
        }
        mes.querySelector('.mes_edit')?.click();
    } else if (action === 'swipe') {
        if (await deleteCurrentSwipe(id)) window.toastr?.success('Swipe deleted.');
    } else if (action === 'hide') {
        // hide 는 is_system = true, unhide 는 false 로 저장됩니다.
        await executeSlashCommandsWithOptions(`/${hidden ? 'unhide' : 'hide'} ${id}`);
        if (linked && setFold(id, !hidden)) await saveChatConditional();   // 연동: hide→fold, unhide→unfold
        if (mes.isConnected) render(mes);   // 접힌 바의 유령 아이콘 갱신
    } else {
        await executeSlashCommandsWithOptions(`/cut ${id}`);
    }
}

// 길게 누르기 초기화. 모든 리스너는 signal 로 한 번에 해제되고,
// 돌려주는 함수는 진행 중인 타이머/테두리 클래스를 정리한다. (destroy 에서 호출)
function initLongPress(root, signal) {
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

    const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal });

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

    on(root, 'pointerdown', (e) => {
        fired = false;
        mode = 'msg';
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        // .mes 밖(아바타 아래 빈 칸 등 래퍼/틈)을 눌러도 좌표로 메시지를 찾아 처리
        let mes = e.target.closest?.('.mes') ?? null;
        if (!mes && e.target === root) mes = findMesAtPoint(root, e.clientX, e.clientY);
        if (!mes || e.target.closest?.(LP_IGNORE)) return;
        if (mes.querySelector('textarea.edit_textarea')) return; // 편집 중이면 무시

        const isTouch = e.pointerType !== 'mouse';
        const inText = !!e.target.closest('.mes_text');

        // 이미 선택된 글자 위를 누른 경우 → 선택 메뉴 모드
        const selHit = inText && hasSelection() && pointOnSelection(e.clientX, e.clientY);

        // 패널에서 꺼 둔 기능은 시작하지 않음 (선택 메뉴 / 메시지 메뉴 각각)
        const st = settings();
        if (selHit ? !st.selectionMenu : !st.longPressMenu) return;

        // 터치 + 본문 영역: 텍스트 선택을 방해하지 않도록 길게 누르기를 시작하지 않음
        if (!selHit && isTouch && TOUCH_TEXT_SELECTABLE && inText && isOnText(e.clientX, e.clientY, e.target.closest('.mes_text'))) return;

        releaseNow();
        cancel();
        pressTouch = isTouch;
        mode = selHit ? 'sel' : 'msg';
        const touchMs = holdTime(st.holdTouch, 750);
        if (selHit) {
            // 선택한 글자 위: 터치(holdSelTouch) / 마우스(holdSelMouse) 각각 별도 설정을 사용
            holdMs = isTouch
                ? holdTime(st.holdSelTouch, DEFAULTS.holdSelTouch, SEL_HOLD_MIN)
                : holdTime(st.holdSelMouse, DEFAULTS.holdSelMouse, SEL_HOLD_MIN_MOUSE);
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

    on(root, 'pointermove', (e) => {
        if (!timer) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) <= MOVE_TOLERANCE) return;

        cancel();
    }, { passive: true });
    on(root, 'pointerup', cancel);
    ['pointercancel', 'pointerleave'].forEach((ev) => on(root, ev, () => {
        // 모바일: 길게 누르는 도중 브라우저가 pointercancel 을 보내는 경우가 있어
        // (아바타 아래 빈 칸 등에서 팝업이 안 뜨던 원인) 터치는 여기서 취소하지 않음.
        // 손가락을 떼면 touchend, 움직이면 touchmove / scroll 에서 취소됨.
        if (pressTouch) return;
        cancel();
    }));
    on(root, 'touchend', cancel, { passive: true });
    on(root, 'touchcancel', cancel, { passive: true });
    on(root, 'touchmove', (e) => {
        if (!timer) return;
        const t = e.touches[0];
        if (!t || Math.hypot(t.clientX - startX, t.clientY - startY) <= MOVE_TOLERANCE) return;
        cancel();
    }, { passive: true });
    on(root, 'scroll', cancel, { passive: true });

    // (터치) 텍스트 선택이 시작되면 대기 취소
    // selectionchange 는 아주 자주 발생하므로 타이머가 돌고 있을 때만 검사
    on(document, 'selectionchange', () => {
        if (timer && mode === 'msg' && pressTouch && hasSelection()) cancel();
    });

    // 길게 누른 직후 발생하는 click / contextmenu 차단
    // (캡처 단계에서 막으므로 접힌 바가 임시로 펼쳐지는 일도 없음)
    on(root, 'click', (e) => {
        if (fired && e.isTrusted) { e.preventDefault(); e.stopPropagation(); fired = false; }
    }, { capture: true });
    on(root, 'contextmenu', (e) => {
        if (timer || fired) e.preventDefault();
    });

    return () => { releaseNow(); cancel(); };
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
    if (settings().batchFold) {
        // 일괄 모드: 데이터만 쭉 수정하고, 화면 갱신은 한 번만 예약 (메시지마다 요소를 찾지 않음)
        for (let i = range.start; i <= range.end; i++) changed = setFoldData(i, fold) || changed;
        if (changed) scheduleRefresh();
    } else {
        for (let i = range.start; i <= range.end; i++) changed = setFold(i, fold) || changed;
    }
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
                    <legend><i class="fa-solid fa-hand-pointer"></i>Long Press Options</legend>
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_long_press_menu">
                            <span class="mf-opt-title mf-strong">Enable Long-press message menu</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_long_press_menu"><span class="mf-slider"></span></span>
                        </label>
                    </div>
                    <div class="mf-item">
                        <div class="mf-head" style="margin-bottom: 6px;">Menu buttons</div>
                        <label class="mf-opt" for="mf_popup_delete">
                            <span class="mf-opt-title">Delete</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_popup_delete"><span class="mf-slider"></span></span>
                        </label>
                        <label class="mf-opt" for="mf_popup_edit">
                            <span class="mf-opt-title">Edit</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_popup_edit"><span class="mf-slider"></span></span>
                        </label>
                        <label class="mf-opt" for="mf_popup_hide">
                            <span class="mf-opt-title">Hide / Unhide</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_popup_hide"><span class="mf-slider"></span></span>
                        </label>
                        <label class="mf-opt" for="mf_popup_fold">
                            <span class="mf-opt-title">Fold / Unfold</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_popup_fold"><span class="mf-slider"></span></span>
                        </label>
                        <label class="mf-opt" for="mf_popup_swipe">
                            <span class="mf-opt-title">Delete swipe</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_popup_swipe"><span class="mf-slider"></span></span>
                        </label> 
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
                            <input type="range" id="mf_hold_mouse" min="400" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_mouse_val"></span>
                        </label>
                        <label class="mf-range">
                            <span class="mf-range-name">Touch</span>
                            <input type="range" id="mf_hold_touch" min="400" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_touch_val"></span>
                        </label>
                        <small class="mf-desc">How long to press before the message popup appears. Longer values help avoid accidental popups.</small>
                    </div>
                </fieldset>
                <fieldset class="mf-box mf-compact">
                    <legend><i class="fa-solid fa-i-cursor"></i>Drag to Edit Options</legend>
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_selection_menu">
                            <span class="mf-opt-title mf-strong">Enable Selection edit &amp; delete</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_selection_menu"><span class="mf-slider"></span></span>
                        </label>
                    </div>
                    <div class="mf-item">
                        <div class="mf-head mf-head-row">
                            <span>Hold time</span>
                            <span class="mf-head-btns">
                                <button type="button" class="mf-reset" id="mf_hold_sel_save" title="Save current text selection hold time" aria-label="Save current text selection hold time"><i class="fa-solid fa-floppy-disk"></i></button>
                                <button type="button" class="mf-reset" id="mf_hold_sel_reset" title="Reset text selection hold time to saved value (or default)" aria-label="Reset text selection hold time to saved value (or default)"><i class="fa-solid fa-rotate-left"></i></button>
                            </span>
                        </div>
                        <label class="mf-range">
                            <span class="mf-range-name">Mouse</span>
                            <input type="range" id="mf_hold_sel_mouse" min="10" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_sel_mouse_val"></span>
                        </label>
                        <label class="mf-range">
                            <span class="mf-range-name">Touch</span>
                            <input type="range" id="mf_hold_sel_touch" min="200" max="1000" step="10">
                            <span class="mf-range-val" id="mf_hold_sel_touch_val"></span>
                        </label>
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
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_batch_fold">
                            <span class="mf-opt-title">Batch /fold &amp; /unfold</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_batch_fold"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Updates all the data first, then redraws the screen only once. Useful when hundreds of messages have piled up and /fold or /unfold takes a long time.</small>
                    </div>
                    <small class="mf-desc mf-hint">Click to expand: unread tint, closing an expanded message, and batch /fold.</small>
                </fieldset>
            </div>
        </div>`;
    host.append(wrap);
    // 패널 안의 리스너는 wrap 과 함께 사라지므로, wrap 만 제거하면 정리 끝
    onDispose(() => wrap.remove());

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
    bind('mf_batch_fold', 'batchFold');
    bind('mf_long_press_menu', 'longPressMenu');
    bind('mf_selection_menu', 'selectionMenu');
    bind('mf_popup_delete', 'popupDelete');
    bind('mf_popup_edit', 'popupEdit');
    bind('mf_popup_hide', 'popupHide');
    bind('mf_popup_fold', 'popupFold');
    bind('mf_popup_swipe', 'popupSwipe');

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
        { ...bindRange('mf_hold_sel_mouse', 'holdSelMouse', DEFAULTS.holdSelMouse, SEL_HOLD_MIN_MOUSE), key: 'holdSelMouse', min: SEL_HOLD_MIN_MOUSE },
        { ...bindRange('mf_hold_sel_touch', 'holdSelTouch', DEFAULTS.holdSelTouch, SEL_HOLD_MIN), key: 'holdSelTouch' },
    ];

    // 길게 누르기 시간 저장 / 초기화 (메시지용 / 선택 글자용 각각)
    //  - 저장 버튼: 현재 슬라이더 값(마우스/터치)을 savedKey 에 보관
    //  - 초기화 버튼: 저장해 둔 값이 있으면 그 값으로, 없으면 기본값으로 되돌림
    const bindHoldButtons = (saveId, resetId, sliders, savedKey, label, min) => {
        // (슬라이더마다 최소값이 다를 수 있음: 각 슬라이더의 min 이 있으면 우선 사용)
        wrap.querySelector(`#${saveId}`).addEventListener('click', () => {
            const st = settings();
            st[savedKey] = {};
            for (const { el, key } of sliders) st[savedKey][key] = Number(el.value);
            ctx().saveSettingsDebounced();
            window.toastr?.success(`${label} saved.`);
        });
        wrap.querySelector(`#${resetId}`).addEventListener('click', () => {
            const st = settings();
            for (const { el, show, key, min: m } of sliders) {
                const v = holdTime(st[savedKey]?.[key], DEFAULTS[key], m ?? min);
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

// ===================== 초기화 =====================

// SillyTavern 이벤트 구독 + 해제 등록을 한 번에
function listen(name, handler) {
    const type = event_types[name];
    if (!type) return;
    eventSource.on(type, handler);
    onDispose(() => (eventSource.removeListener ?? eventSource.off)?.call(eventSource, type, handler));
}

function init() {
    // 확장이 다시 로드된 경우 이전 인스턴스를 먼저 정리 (리스너/옵저버 중복 방지)
    globalThis.__messageFoldDestroy?.();
    globalThis.__messageFoldDestroy = destroy;

    ac = new AbortController();
    const { signal } = ac;

    initSettingsPanel();
    registerSlashCommands();

    chatEl = document.getElementById('chat');
    if (!chatEl) return;

    syncChatClasses();   // 첫 렌더 전에 클래스부터 맞춤 (버튼이 잠깐 깜빡이는 것 방지)

    document.addEventListener('click', onDocumentClick, { signal });

    chatEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const t = e.target.closest?.(`${FOLD_BTN_SELECTOR}, .mf-placeholder`);
        if (!t) return;
        e.preventDefault();
        const mes = t.closest('.mes');
        if (!mes) return;
        if (t.matches(FOLD_BTN_SELECTOR)) toggleFold(mes);
        else openTemp(mes);
    }, { signal });

    // 새로 추가된 .mes 만 골라서 갱신 (전체를 다시 훑지 않음)
    const childObserver = new MutationObserver((records) => {
        for (const r of records) {
            for (const node of r.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('mes')) scheduleRefresh(node);
            }
        }
    });
    childObserver.observe(chatEl, { childList: true });
    onDispose(() => childObserver.disconnect());

    // Hide & Fold 연동: SillyTavern 이 hide/unhide 할 때 바꾸는 .mes 의 is_system 속성을 감시
    // (/hide, /unhide, 기본 hide 아이콘, 이 확장의 팝업 모두 여기서 잡힘)
    const hideObserver = new MutationObserver((records) => {
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
    });
    hideObserver.observe(chatEl, { subtree: true, attributes: true, attributeFilter: ['is_system'], attributeOldValue: true });
    onDispose(() => hideObserver.disconnect());

    // 채팅이 바뀌거나 메시지가 삭제되면 id 가 달라질 수 있으므로 임시 펼침 상태 초기화
    // 자동 접기/숨기기 기준선: 채팅을 열 때 기존 메시지 수로 갱신, 삭제로 줄어들면 같이 낮춤
    syncBaseline();
    listen('CHAT_CHANGED', () => { syncBaseline(); openId = null; });
    listen('MESSAGE_DELETED', () => { autoBaseline = Math.min(autoBaseline, chat.length); openId = null; });

    // 전체 갱신이 필요한 이벤트 (채팅 전환 / 삭제로 id 가 밀림 / 이전 메시지 더 불러오기)
    ['CHAT_CHANGED', 'MESSAGE_DELETED', 'MORE_MESSAGES_LOADED'].forEach((name) => listen(name, () => scheduleRefresh()));
    // 메시지 하나만 바뀌는 이벤트 (첫 인자가 메시지 id)
    [
        'CHARACTER_MESSAGE_RENDERED',
        'USER_MESSAGE_RENDERED',
        'MESSAGE_UPDATED',
        'MESSAGE_EDITED',
        'MESSAGE_SWIPED',
    ].forEach((name) => listen(name, (id) => scheduleRefresh(id)));

    const stopLongPress = initLongPress(chatEl, signal);

    // 정리: 대기 중인 프레임/타이머를 취소하고, 이 확장이 만든 DOM 과 클래스를 제거
    onDispose(() => {
        stopLongPress();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        needFull = false;
        dirtyIds.clear();
        dirtyEls.clear();
        if (chatEl) {
            chatEl.classList.remove('mf-replace');
            chatEl.querySelectorAll('.mf-placeholder, .mes_fold, .mes_unfold').forEach((el) => el.remove());
            chatEl.querySelectorAll('.mes').forEach((m) => m.classList.remove('mf-folded', 'mf-pinned', 'mf-unseen', 'lpd-pressing', 'lpd-touch', 'lpd-nosel'));
        }
    });

    scheduleRefresh();
}

jQuery(init);
