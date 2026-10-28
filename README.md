# Message Fold and Delete

A SillyTavern extension that folds messages into a single bar and manages messages or selected text with a long press.

## Features

<div align="center">
<img width="1053" height="411" alt="화면 캡처 2026-10-21 175828" src="https://github.com/user-attachments/assets/f89acdad-bbed-47e8-8ac7-21666090124d" />
</div>

* **Fold / Unfold** – Click the fold icon in the message action buttons to collapse the message into a slim bar.
* **Peek (Temporary unfold)** – Tap a folded bar to open it temporarily. Depending on your settings, clicking outside or double-clicking the message folds it again. To unfold permanently, click the unfold icon.

<div align="center">
<img width="651" height="275" alt="화면 캡처 2026-10-21 175751" src="https://github.com/user-attachments/assets/d329bf1c-bead-48cb-b85b-619a9e39f9f6" />
</div>

* **Long-press message menu** – Press and hold a message to open a popup: **Delete**, **Hide (Unhide)**, **Fold (Unfold)**, and **Cancel**. On mobile, a visual border feedback appears before the popup opens.

<div align="center">
<img width="50%" alt="20261021_225652" src="https://github.com/user-attachments/assets/6a809379-6d98-4381-adad-e3992c9c2a3c" />
</div>

* **Selected text menu** – Select text inside a message, then press and hold the selection to open a popup: **Edit selection**, **Delete selection**, and **Cancel**.
* **Replace all** – When editing selected text that appears multiple times in the message, check "Replace all" to replace every occurrence at once.
* **`/fold` and `/unfold` commands** – Supports single message indices or ranges:
  * `/fold 3` : message 3
  * `/fold 2-5` : messages 2 to 5
* **Link Hide & Fold** – Hiding a message automatically folds it, and unhiding unfolds it.
* **Auto Fold & Hide** – Automatically fold and/or hide newly generated messages (slash commands or character replies).

## Settings Panel

<div align="center">
<img width="507" height="691" alt="image" src="https://github.com/user-attachments/assets/bba811cc-d60d-4dbd-9fa7-9668bbda245e" />
</div>

Open the Extensions panel (`Extensions` → `Message Fold & Delete`) to configure options:

### 1. Hide & Fold
* **Link Hide & Fold** – Links message hiding and folding together.
  * **Keep Fold button** – Keeps Hide and Fold as separate buttons.
  * **Replace Fold button** – Merges them into a single "Hide & Fold" (or "Unhide & Unfold") button.

### 2. Auto Fold & Hide
* **Target messages**
  * **Comments only** – Only applies to slash-command messages (e.g., `/comment`, `/sendas`).
  * **All non-user messages** – Applies to all incoming character replies and slash-command messages (your own user messages are never affected).
* **Auto-fold** – Folds target messages as soon as they appear.
* **Auto-hide** – Hides target messages so they are excluded from context/prompts.

### 3. Delete & Edit
* **Long-press message menu** – Enable or disable the message long-press menu.
* **Selection edit & delete** – Enable or disable the long-press menu on selected text.
* **Hold time** – Adjust how long to press before the popup triggers (Mouse / Touch: 500ms – 1000ms).

### 4. Other Settings
* **Tint unread folded messages** – Applies a soft theme tint to automatically folded bars until you click them for the first time.
* **Close an expanded message**
  * **Click elsewhere** – Clicking anywhere outside the message closes it.
  * **Double-click the message** – Double-clicking (or double-tapping) the message itself closes it.

## Customization

Add the following to **Custom CSS** if needed:

```css
:root {
    --mf-min-height: 40px;   /* Minimum height of a folded bar */
    --mf-gap: 6px;           /* Gap between folded bars */
    --mf-tint-alpha: 20%;    /* Tint opacity for unread auto-folded bars */
    --mf-tint-color: #4aa;   /* Tint color (default: --SmartThemeQuoteColor) */
}
```

## Notes

* **Text replacement source matching**: Replacements are matched against the raw saved message source. If text differs due to display macros (e.g. `{{user}}`) or regex scripts, a warning will appear and no changes will be made.

## License

AGPL-3.0

<br><br><br><br>

# Message Fold and Delete

메시지를 얇은 한 줄 바로 접고, 길게 눌러 메시지나 선택한 텍스트를 손쉽게 관리하는 SillyTavern 확장 기능입니다.

## 주요 기능

<div align="center">
<img width="1053" height="411" alt="화면 캡처 2026-10-21 175828" src="https://github.com/user-attachments/assets/f89acdad-bbed-47e8-8ac7-21666090124d" />
</div>

* **접기 / 펼치기** – 메시지 액션 버튼의 접기 아이콘을 누르면 메시지가 한 줄 바로 접힙니다.
* **미리보기 (임시 펼치기)** – 접힌 바를 누르면 임시로 펼쳐집니다. 설정에 따라 바깥을 누르거나 메시지를 더블클릭(더블탭)하면 다시 접힙니다. 영구히 펼치려면 펼치기 아이콘을 누릅니다.

<div align="center">
<img width="651" height="275" alt="화면 캡처 2026-10-21 175751" src="https://github.com/user-attachments/assets/d329bf1c-bead-48cb-b85b-619a9e39f9f6" />
</div>

* **길게 누르기 메뉴** – 메시지를 길게 누르면 팝업이 표시됩니다: **삭제(Delete)**, **숨기기/해제(Hide/Unhide)**, **접기/해제(Fold/Unfold)**, **취소(Cancel)**. 모바일 환경에서는 팝업 직전에 테두리 애니메이션 피드백이 표시됩니다.

<div align="center">
<img width="50%" alt="20261021_225652" src="https://github.com/user-attachments/assets/6a809379-6d98-4381-adad-e3992c9c2a3c" />
</div>

* **선택한 글자 메뉴** – 텍스트를 드래그하여 선택한 뒤 길게 누르면 **글자 편집(Edit)** 및 **삭제(Delete)** 팝업이 뜹니다.
* **모두 바꾸기 (Replace all)** – 선택한 글자가 해당 메시지 안에 여러 번 나오면 "모두 바꾸기" 체크박스를 통해 한 번에 일괄 수정할 수 있습니다.
* **`/fold`, `/unfold` 명령어** – `/hide`처럼 번호나 범위를 지정하여 접고 펼칠 수 있습니다.
  * `/fold 3` : 3번 메시지 접기
  * `/fold 2-5` : 2번부터 5번까지 접기
* **Hide & Fold 연동** – 메시지를 숨기면 자동으로 접히고, 숨김을 해제하면 자동으로 펼쳐집니다.
* **자동 접기 및 숨기기** – 새로 생성되는 메시지(슬래시 명령어 또는 캐릭터 답변)를 조건에 따라 자동으로 접거나 숨깁니다.

## 확장 설정 (Settings)

<div align="center">
<img width="507" height="691" alt="image" src="https://github.com/user-attachments/assets/bba811cc-d60d-4dbd-9fa7-9668bbda245e" />
</div>

확장 패널(`Extensions` → **Message Fold & Delete**)에서 설정할 수 있습니다.

### 1. Hide & Fold (숨김 & 접기 연동)
* **Link Hide & Fold** – 연동 기능 On/Off
  * **Keep Fold button** – Fold/Unfold 버튼을 별도로 유지합니다.
  * **Replace Fold button** – Hide와 Fold를 "Hide & Fold" 단일 버튼으로 통합합니다.

### 2. Auto Fold & Hide (자동 접기 & 숨기기)
* **Target messages (대상 선택)**
  * **Comments only** – `/comment`, `/sendas` 등 슬래시 명령어로 만든 메시지만 대상
  * **All non-user messages** – 유저 메시지를 제외한 캐릭터의 모든 답변 및 메시지 대상
* **Auto-fold** – 대상 메시지가 생성되면 즉시 접습니다.
* **Auto-hide** – 대상 메시지를 숨겨 프롬프트 전송에서 제외합니다.

### 3. Delete & Edit (길게 누르기 설정)
* **Long-press message menu** – 메시지 길게 누르기 팝업 On/Off
* **Selection edit & delete** – 선택 글자 길게 누르기 팝업 On/Off
* **Hold time** – 팝업이 뜨기까지 길게 누르는 시간 설정 (마우스 / 터치 각각 500ms ~ 1000ms 조절 가능)

### 4. Other Settings (기타 설정)
* **Tint unread folded messages** – 자동 접힘 후 사용자가 아직 눌러보지 않은 바에 인용문 색상 틴트를 덧입힙니다. (첫 클릭 시 해제)
* **Close an expanded message (펼친 메시지 닫기)**
  * **Click elsewhere** – 메시지 바깥 아무 곳이나 클릭/탭하면 다시 접힘 (기본값)
  * **Double-click the message** – 해당 메시지를 더블클릭(더블탭)해야 다시 접힘 (바깥 클릭 방지)

## 사용자 커스텀 (CSS)

필요한 경우 **Custom CSS**에 추가하여 스타일을 변경할 수 있습니다:

```css
:root {
    --mf-min-height: 40px;   /* 접힌 바의 최소 높이 */
    --mf-gap: 6px;           /* 접힌 바 사이의 상하 간격 */
    --mf-tint-alpha: 20%;    /* 미확인 자동 접힘 바 색상 덧입힘 투명도 */
    --mf-tint-color: #4aa;   /* 덧입힘 색상 (기본값: 테마 인용문 색상) */
}
```

## 참고 사항

* **원문 매칭**: 선택 글자 편집/삭제는 저장된 메시지 원문을 기준으로 처리됩니다. 매크로(`{{user}}`)나 정규식 스크립트로 인해 화면 렌더링과 원문이 달라진 경우에는 원문을 찾지 못해 수정이 취소될 수 있습니다.

## License

AGPL-3.0
