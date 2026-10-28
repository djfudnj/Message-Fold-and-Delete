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
//  - 빨간 테두리 피드백은 터치(모바일)에서만 나타납니다.
//  - /fold, /unfold 슬래시 명령어 (/hide 처럼 인덱스 또는 범위: /fold 3, /fold 2-5, /fold 4-)
//  - 확장 패널 옵션
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
const DEFAULTS = { linkHideFold: false, linkMode: 'replace', autoFoldComments: false, autoHideComments: false };

function settings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    for (const [k, v] of Object.entries(DEFAULTS)) extensionSettings[MODULE][k] ??= v;
    return extensionSettings[MODULE];
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

// 상태에 따라 번갈아 나오는 두 개의 버튼 (message hide/unhide 처럼 서로 다른 버튼이 같은 자리에서 교체)
//  - .mes_fold   : 아직 접기 설정이 안 된 상태에서 보임 → 누르면 접기 설정
//  - .mes_unfold : 접기 설정된 상태에서 보임        → 누르면 접기 해제
const ICON_SET = 'fa-compress';
const ICON_UNSET = 'fa-expand';
const TITLE_SET = 'Fold message';
const TITLE_UNSET = 'Unfold message';
const FOLD_BTN_SELECTOR = '.mes_fold, .mes_unfold';

// ===== 길게 누르기 설정 =====
const HOLD_MS_MOUSE = 610;  // 마우스 길게 누르기 시간
const HOLD_MS_TOUCH = 750;  // 터치(모바일) 길게 누르기 시간
const HOLD_MS_TOUCH_SEL = 600; // 터치: 이미 선택된 글자 위에서 길게 누르는 시간 (선택 메뉴용)
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

// 테마가 덮어써도 바가 항상 보이도록 인라인 !important 로 지정
function setImportant(el, styles) {
    for (const [prop, val] of Object.entries(styles)) {
        el.style.setProperty(prop, val, 'important');
    }
}

function clearImportant(el, props) {
    props.forEach((p) => el.style.removeProperty(p));
}

const FIX_PROPS = ['height', 'min-height', 'max-height', 'overflow'];

function styleBar(ph, collapsed, block) {
    if (!collapsed) {
        setImportant(ph, { display: 'none' });
        return;
    }
    // .mes_block 의 좌우 padding 만큼 바깥으로 확장해서 블록 전체 폭에 맞춤
    let pl = 0;
    let pr = 0;
    if (block) {
        const cs = getComputedStyle(block);
        pl = parseFloat(cs.paddingLeft) || 0;
        pr = parseFloat(cs.paddingRight) || 0;
    }
    // .mes_block 의 폭을 그대로 따라가며, 테마 색상 변수로 배경/테두리를 입힘
    setImportant(ph, {
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        width: `calc(100% + ${pl + pr}px)`,
        'min-height': 'var(--mf-min-height, 34px)',
        'box-sizing': 'border-box',
        padding: '6px 10px',
        'margin-left': `${-pl}px`,
        'margin-right': `${-pr}px`,
        'margin-top': '0',
        'margin-bottom': '0',
        position: 'relative',
        visibility: 'visible',
        opacity: '1',
        overflow: 'hidden',
        cursor: 'pointer',
        color: 'var(--SmartThemeBodyColor, #ddd)',
        background: 'var(--SmartThemeBlurTintColor, rgba(128,128,128,.18))',
        border: '1px solid var(--SmartThemeBorderColor, rgba(128,128,128,.5))',
        'border-radius': '8px',
        'font-size': '13px',
        'line-height': '1.4',
    });
}

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

function render(mes) {
    const id = Number(mes.getAttribute('mesid'));
    const folded = isFolded(id);                 // 저장된 접힘 상태
    const collapsed = folded && openId !== id;   // 실제로 접혀 보이는지 (임시로 펼친 경우 제외)

    const unseen = folded && !!chat[id]?.extra?.[UNSEEN_KEY];   // 자동 접힘 후 아직 안 눌러본 상태
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
        foldBtn.title = TITLE_SET;
        foldBtn.style.display = (folded || replaceFold) ? 'none' : '';
    }
    const unfoldBtn = mes.querySelector('.mes_unfold');
    if (unfoldBtn) {
        unfoldBtn.style.display = (folded && !replaceFold) ? '' : 'none';
    }

    // 높이만 풀어줌 (display/padding/폭은 테마 그대로 유지)
    const block = mes.querySelector('.mes_block');
    [mes, block].forEach((el) => {
        if (!el) return;
        if (collapsed) setImportant(el, { height: 'auto', 'min-height': '0', 'max-height': 'none', overflow: 'visible' });
        else clearImportant(el, FIX_PROPS);
    });

    const ph = mes.querySelector('.mf-placeholder');
    if (ph) {
        if (collapsed) {
            const { name, snippet } = makePreview(id);
            ph.replaceChildren();
            // comment 는 말풍선 아이콘, 숨김(hide) 처리된 메시지(is_system)는 유령 아이콘, 그 외는 ▶
            let arrow;
            if (isComment(chat[id])) {
                arrow = document.createElement('i');
                arrow.className = 'fa-solid fa-comment-dots';
                arrow.title = 'Comment';
            } else if (chat[id]?.is_system) {
                arrow = document.createElement('i');
                arrow.className = 'fa-solid fa-ghost';
                arrow.title = 'Hidden message';
            } else {
                arrow = document.createElement('span');
                arrow.textContent = '▶';
            }
            arrow.style.setProperty('flex', '0 0 auto');
            const nm = document.createElement('b');
            nm.textContent = name;
            nm.style.setProperty('flex', '0 0 auto');
            const tx = document.createElement('span');
            tx.textContent = snippet ? `— ${snippet}` : '';
            setImportant(tx, { 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', opacity: '0.8' });
            ph.append(arrow, nm, tx);
        }
        styleBar(ph, collapsed, block);
    }
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
    if (!st.autoFoldComments && !st.autoHideComments) return;

    let changed = false;
    const toHide = [];
    chat.forEach((msg, id) => {
        if (!isSlashMade(msg)) return;
        if (st.autoFoldComments && !msg.extra[AUTO_KEY]) {
            msg.extra[AUTO_KEY] = true;
            msg.extra[KEY] = true;
            msg.extra[UNSEEN_KEY] = true;
            changed = true;
        }
        if (st.autoHideComments && !msg.extra[AUTO_HIDE_KEY]) {
            msg.extra[AUTO_HIDE_KEY] = true;
            changed = true;
            if (!msg.is_system) toHide.push(id);   // comment 는 원래 is_system 이라 이미 숨김 상태
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

    if (openId === id) return;
    openId = id;
    refreshAll();
}

// 임시로 펼친 메시지를 다시 접음
function closeTemp() {
    if (openId === null) return;
    openId = null;
    refreshAll();
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

    // 펼쳐진 챗 자신을 누른 경우는 그대로 유지
    const mes = el.closest('#chat .mes');
    if (mes && Number(mes.getAttribute('mesid')) === openId) return;

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

    return { mes, text, occurrence };
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

// 화면에 보이는 글자를 저장된 원문(chat[id].mes)에서 찾음
function findInRaw(raw, text, occurrence) {
    const idx = [];
    for (let i = raw.indexOf(text); i !== -1; i = raw.indexOf(text, i + 1)) idx.push(i);
    if (!idx.length) return null;
    const start = idx[occurrence] ?? (idx.length === 1 ? idx[0] : undefined);
    return start === undefined ? null : { start, end: start + text.length };
}

// 메시지 본문을 통째로 교체하고 저장 (SillyTavern 기본 편집 저장과 같은 순서)
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

async function replaceSelection(id, text, occurrence, replacement) {
    const raw = String(chat[id]?.mes ?? '');
    const loc = findInRaw(raw, text, occurrence);
    if (!loc) {
        window.toastr?.warning('Could not locate the selected text in the message source.');
        return;
    }
    await setMessageText(id, raw.slice(0, loc.start) + replacement + raw.slice(loc.end));
}

const countOccurrences = (raw, text) => (text ? raw.split(text).length - 1 : 0);

async function showSelectionMenu(mes, info) {
    const id = Number(mes.getAttribute('mesid'));
    if (Number.isNaN(id) || !chat[id]) return;

    const { text, occurrence } = info;
    const name = chat[id].name || '';
    const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;

    const html = `<h3>Selected text</h3>
        <div style="text-align:left;opacity:.8;margin-top:8px">
            <b>#${id}</b> ${escapeHtml(name)}<br>“${escapeHtml(preview)}”
        </div>`;

    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    if (!callGenericPopup || !POPUP_TYPE) return;

    const CUSTOM_EDIT = POPUP_RESULT?.CUSTOM1 ?? 1001;
    const RESULT_CANCEL = POPUP_RESULT?.NEGATIVE ?? 0;

    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Delete',
        cancelButton: 'Cancel',
        defaultResult: RESULT_CANCEL,
        customButtons: [{ text: 'Edit', result: CUSTOM_EDIT }],
    });

    let action = null;
    if (POPUP_RESULT ? result === POPUP_RESULT.AFFIRMATIVE : result === true) action = 'delete';
    else if (result === CUSTOM_EDIT) action = 'edit';
    if (!action) return;

    if (!mes.isConnected || Number(mes.getAttribute('mesid')) !== id) return;

    // 원문에 해당 글자가 없으면(매크로/정규식 등으로 화면과 원문이 다른 경우) 알림
    const raw0 = String(chat[id].mes ?? '');
    if (!raw0.includes(text)) {
        window.toastr?.warning('Could not locate the selected text in the message source.');
        return;
    }

    if (action === 'delete') {
        await replaceSelection(id, text, occurrence, '');
        return;
    }

    // ----- Edit selection: 바꿀 글자를 입력. 같은 글자가 여러 개면 "모두 바꾸기" 체크박스 표시 -----
    const total = countOccurrences(raw0, text);
    let replaceAll = false;
    const checkbox = total > 1
        ? `<label class="checkbox_label" style="justify-content:center;margin-top:10px">
               <input type="checkbox" id="mf-replace-all">
               <span>Replace all ${total} occurrences in this message</span>
           </label>`
        : '';

    const edited = await callGenericPopup(
        `<h3>Edit selection</h3>
         <div style="text-align:left;opacity:.8;margin-top:8px"><b>#${id}</b> ${escapeHtml(name)}</div>
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
        const cur = String(chat[id]?.mes ?? '');
        if (!cur.includes(text)) {
            window.toastr?.warning('The message changed; nothing was replaced.');
            return;
        }
        await setMessageText(id, cur.split(text).join(edited));
        window.toastr?.success(`Replaced ${countOccurrences(cur, text)} occurrence(s).`);
    } else {
        await replaceSelection(id, text, occurrence, edited);
    }
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
    // comment 는 원래 system 메시지라 연동 대상에서 제외 (replace 에서는 Fold 만 표시)
    const mode = linkMode();
    const comment = isComment(chat[id]);
    const linked = !!mode && !comment;
    const foldButton = { text: folded ? 'Unfold' : 'Fold', result: CUSTOM_FOLD };
    const hideButton = { text: hidden ? 'Unhide' : 'Hide', result: CUSTOM_HIDE };
    let customButtons;
    if (mode === 'replace' && comment) customButtons = [foldButton];
    else if (mode === 'replace') customButtons = [{ text: hidden ? 'Unhide & Unfold' : 'Hide & Fold', result: CUSTOM_HIDE }];
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
    let holdMs = HOLD_MS_MOUSE;

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

        // 터치 + 본문 영역: 텍스트 선택을 방해하지 않도록 길게 누르기를 시작하지 않음
        if (!selHit && isTouch && TOUCH_TEXT_SELECTABLE && inText && isOnText(e.clientX, e.clientY, e.target.closest('.mes_text'))) return;

        releaseNow();
        cancel();
        pressTouch = isTouch;
        mode = selHit ? 'sel' : 'msg';
        holdMs = !isTouch ? HOLD_MS_MOUSE : (selHit ? HOLD_MS_TOUCH_SEL : HOLD_MS_TOUCH);

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
        if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
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
                <fieldset class="mf-box">
                    <legend><i class="fa-solid fa-bolt"></i>Auto Fold &amp; Hide Comments</legend>
                    <small class="mf-desc mf-intro">Only affects comment-style messages, the ones created by slash commands like /comment and /sendas. Normal chat replies are never touched.</small>
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_auto_fold_comments">
                            <span class="mf-opt-title">Auto-fold</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_auto_fold_comments"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Folds them as soon as they appear. The bar stays tinted until you open it for the first time.</small>
                    </div>
                    <div class="mf-item">
                        <label class="mf-opt" for="mf_auto_hide_comments">
                            <span class="mf-opt-title">Auto-hide</span>
                            <span class="mf-switch"><input type="checkbox" id="mf_auto_hide_comments"><span class="mf-slider"></span></span>
                        </label>
                        <small class="mf-desc">Hides them too, so they are left out of the prompt.</small>
                    </div>
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
            if (now === r.oldValue) continue;
            const id = Number(mes.getAttribute('mesid'));
            if (Number.isNaN(id) || !chat[id] || isComment(chat[id])) continue;
            changed = setFold(id, now === 'true') || changed;
        }
        if (changed) saveChatConditional();
    }).observe(chatEl, { subtree: true, attributes: true, attributeFilter: ['is_system'], attributeOldValue: true });

    // 채팅이 바뀌거나 메시지가 삭제되면 id 가 달라질 수 있으므로 임시 펼침 상태 초기화
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
