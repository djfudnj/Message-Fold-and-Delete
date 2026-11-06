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
  * **Mouse** – Works anywhere on the message except links, buttons, images, and edit areas.
  * **Touch** – Long-pressing the message text selects text as usual. Long-press the name, avatar, margins, or a folded bar instead.

<div align="center">
<img width="50%" alt="20261021_225652" src="https://github.com/user-attachments/assets/6a809379-6d98-4381-adad-e3992c9c2a3c" />
</div>

* **Selected text menu** – Select text inside a message, then press and hold the selection to open a popup: **Edit**, **Delete**, and **Cancel**.
* **Translation support** – If the message has a translation, the popup becomes **Edit translation**, **Edit original**, **Delete (translation)**, and **Cancel**. Editing the translation never touches the original text that goes into the prompt.
* **Paragraph editing fallback** – If the selected text can't be found exactly in the saved source (markdown, XML tags, regex scripts, etc.), **Edit** opens the whole matching paragraph(s) in an edit box instead.
* **Replace all** – When editing selected text that appears multiple times in the message, check "Replace all" to replace every occurrence at once.
* **`/fold` and `/unfold` commands** – Supports single message indices or ranges:
  * `/fold 3` : message 3
  * `/fold 2-5` : messages 2 to 5
* **Link Hide & Fold** – Hiding a message automatically folds it, and unhiding unfolds it. Works with `/hide`, `/unhide`, the hide icon, and the long-press popup.
* **Auto Fold & Hide** – Automatically fold and/or hide newly created messages (slash commands, character replies, or all messages). Messages that already exist are never touched.

## Settings Panel

<div align="center">
<img width="506" height="882" alt="image" src="https://github.com/user-attachments/assets/59e02f75-1a8f-4e80-8b20-ad1f986f99e6" />
</div>

Open the Extensions panel (`Extensions` → `Message Fold & Delete`) to configure options:

### 1. Hide & Fold
* **Link Hide & Fold** – Links message hiding and folding together.
  * **Keep Fold button** – Keeps Hide and Fold as separate buttons.
  * **Replace Fold button** – Merges them into a single "Hide & Fold" (or "Unhide & Unfold") button.

### 2. Auto Fold & Hide
* **Target messages**
  * **None** – Auto-fold and auto-hide are turned off (default).
  * **Comments only** – Only applies to slash-command messages (e.g., `/comment`, `/sendas`).
  * **All non-user messages** – Applies to all character replies and slash-command messages (your own messages are not affected).
  * **All messages** – Applies to every new message, including your own.
* **Auto-fold** – Folds target messages as soon as they appear.
* **Auto-hide** – Hides target messages so they are excluded from context/prompts.

### 3. Delete & Edit
* **Long-press message menu** – Enable or disable the message long-press menu.
* **Selection edit & delete** – Enable or disable the long-press menu on selected text.
* **Hold time** – Adjust how long to press before the message popup triggers
* **Text selection hold time** – Adjust how long to press selected text before the Edit / Delete popup triggers. Lower the mouse value to open the popup right after you drag-select and click the selection.
* **Save / Reset buttons** – The floppy icon saves your current values. The reset icon restores the saved values, or the defaults if nothing is saved.

### 4. Other Settings
* **Tint unread folded messages** – Applies a soft theme tint to automatically folded bars until you click them for the first time.
* **Close an expanded message**
  * **Click elsewhere** – Clicking anywhere outside the message closes it.
  * **Double-click the message** – Double-clicking (or double-tapping) the message itself closes it.
* **Batch /fold & /unfold** – Updates all the data first, then redraws the screen only once. Useful when hundreds of messages have piled up and `/fold` or `/unfold` takes a long time.

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

* **Text replacement source matching**: Selected text is matched against the raw saved message source. If it can't be found exactly (display macros like `{{user}}`, markdown, XML tags, or regex scripts), **Edit** falls back to editing the whole paragraph. **Delete** shows a warning and changes nothing, so use Edit instead.
* **No undo**: Deleting a message or editing/deleting selected text is saved to the chat file right away and can't be undone.
* **Auto-hide and prompts**: Hidden messages are left out of the prompt. With "All non-user messages" or "All messages" plus Auto-hide, the AI will not see those replies in later generations.
* **Stored data**: Fold state is saved in each message's `extra` data in the chat file. It is harmless if you uninstall the extension.

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
  * **마우스** – 링크, 버튼, 이미지, 편집 영역을 제외한 메시지 어디서든 작동합니다.
  * **터치** – 본문 글자를 길게 누르면 평소처럼 텍스트가 선택됩니다. 이름, 아바타, 여백, 접힌 바를 길게 눌러 주세요.

<div align="center">
<img width="50%" alt="20261021_225652" src="https://github.com/user-attachments/assets/6a809379-6d98-4381-adad-e3992c9c2a3c" />
</div>

* **선택한 글자 메뉴** – 텍스트를 드래그하여 선택한 뒤 길게 누르면 **편집(Edit)**, **삭제(Delete)**, **취소(Cancel)** 팝업이 뜹니다.
* **번역문 지원** – 메시지에 번역문이 있으면 **번역문 편집(Edit translation)**, **원문 편집(Edit original)**, **번역문 삭제(Delete (translation))**, **취소(Cancel)** 로 바뀝니다. 번역문을 수정해도 프롬프트에 들어가는 원문은 건드리지 않습니다.
* **문단 단위 편집 (폴백)** – 선택한 글자가 저장된 원문에 그대로 없을 때(마크다운, XML 태그, 정규식 스크립트 등) **편집**을 누르면 해당 문단 전체를 편집창에 띄웁니다.
* **모두 바꾸기 (Replace all)** – 선택한 글자가 해당 메시지 안에 여러 번 나오면 "모두 바꾸기" 체크박스를 통해 한 번에 일괄 수정할 수 있습니다.
* **`/fold`, `/unfold` 명령어** – `/hide`처럼 번호나 범위를 지정하여 접고 펼칠 수 있습니다.
  * `/fold 3` : 3번 메시지 접기
  * `/fold 2-5` : 2번부터 5번까지 접기
* **Hide & Fold 연동** – 메시지를 숨기면 자동으로 접히고, 숨김을 해제하면 자동으로 펼쳐집니다. `/hide`, `/unhide`, 숨기기 아이콘, 길게 누르기 팝업 모두에서 작동합니다.
* **자동 접기 및 숨기기** – 새로 생성되는 메시지(슬래시 명령어, 캐릭터 답변, 또는 전체 메시지)를 조건에 따라 자동으로 접거나 숨깁니다. 이미 있던 메시지는 건드리지 않습니다.

## 확장 설정 (Settings)

<div align="center">
<img width="506" height="882" alt="image" src="https://github.com/user-attachments/assets/59e02f75-1a8f-4e80-8b20-ad1f986f99e6" />
</div>

확장 패널(`Extensions` → **Message Fold & Delete**)에서 설정할 수 있습니다.

### 1. Hide & Fold (숨김 & 접기 연동)
* **Link Hide & Fold** – 연동 기능 On/Off
  * **Keep Fold button** – Fold/Unfold 버튼을 별도로 유지합니다.
  * **Replace Fold button** – Hide와 Fold를 "Hide & Fold" 단일 버튼으로 통합합니다.

### 2. Auto Fold & Hide (자동 접기 & 숨기기)
* **Target messages (대상 선택)**
  * **None** – 자동 접기/숨기기를 끕니다 (기본값).
  * **Comments only** – `/comment`, `/sendas` 등 슬래시 명령어로 만든 메시지만 대상
  * **All non-user messages** – 캐릭터의 모든 답변 및 슬래시 명령어 메시지 대상 (내가 보낸 메시지는 제외)
  * **All messages** – 내가 보낸 메시지를 포함한 모든 새 메시지 대상
* **Auto-fold** – 대상 메시지가 생성되면 즉시 접습니다.
* **Auto-hide** – 대상 메시지를 숨겨 프롬프트 전송에서 제외합니다.

### 3. Delete & Edit (길게 누르기 설정)
* **Long-press message menu** – 메시지 길게 누르기 팝업 On/Off
* **Selection edit & delete** – 선택 글자 길게 누르기 팝업 On/Off
* **Hold time** – 메시지 팝업이 뜨기까지 길게 누르는 시간 설정
* **Text selection hold time** – 선택한 글자 위에서 편집/삭제 팝업이 뜨기까지 길게 누르는 시간 설정. 마우스 값을 낮추면 드래그로 선택한 직후 선택 영역을 클릭하자마자 팝업이 뜹니다.
* **저장 / 초기화 버튼** – 디스크 아이콘은 현재 값을 저장하고, 초기화 아이콘은 저장해 둔 값(없으면 기본값)으로 되돌립니다.

### 4. Other Settings (기타 설정)
* **Tint unread folded messages** – 자동 접힘 후 사용자가 아직 눌러보지 않은 바에 인용문 색상 틴트를 덧입힙니다. (첫 클릭 시 해제)
* **Close an expanded message (펼친 메시지 닫기)**
  * **Click elsewhere** – 메시지 바깥 아무 곳이나 클릭/탭하면 다시 접힘 (기본값)
  * **Double-click the message** – 해당 메시지를 더블클릭(더블탭)해야 다시 접힘 (바깥 클릭 방지)
* **Batch /fold & /unfold** – 데이터를 먼저 모두 수정한 뒤 화면은 한 번만 다시 그립니다. 메시지가 수백 개 쌓여서 `/fold`, `/unfold` 명령어가 오래 걸릴 때 유용합니다.

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

* **원문 매칭**: 선택 글자 편집/삭제는 저장된 메시지 원문을 기준으로 처리됩니다. 매크로(`{{user}}`), 마크다운, XML 태그, 정규식 스크립트 등으로 화면과 원문이 달라서 정확히 찾지 못하면, **편집**은 문단 전체 편집으로 전환되고 **삭제**는 비활성화 됩니다. 이때는 편집을 이용해 주세요.
* **되돌리기 불가**: 메시지 삭제와 선택 글자 편집/삭제는 즉시 채팅 파일에 저장되며 되돌릴 수 없습니다.
* **자동 숨기기와 프롬프트**: 숨겨진 메시지는 프롬프트에서 제외됩니다. "All non-user messages" 또는 "All messages"에 Auto-hide를 함께 켜면 이후 생성에서 AI가 해당 답변을 보지 못합니다.
* **저장되는 데이터**: 접힘 상태는 채팅 파일의 각 메시지 `extra` 데이터에 저장되며, 확장을 삭제해도 문제되지 않습니다.

## License

AGPL-3.0
