# Message Fold and Delete

A SillyTavern extension that folds messages into a single bar and manages messages or selected text with a long press.

## Features

<img width="1053" height="411" alt="화면 캡처 2026-10-21 175828" src="https://github.com/user-attachments/assets/f89acdad-bbed-47e8-8ac7-21666090124d" />

* **Fold / Unfold** – Click the fold icon in a message's action buttons to collapse the message into a slim bar. The fold icon is the leftmost icon of the message actions.
* **Peek** – Tap a folded bar to open it temporarily. Tap elsewhere to fold it again. To release the fold completely, click the unfold icon.

<img width="651" height="275" alt="화면 캡처 2026-10-21 175751" src="https://github.com/user-attachments/assets/d329bf1c-bead-48cb-b85b-619a9e39f9f6" />

* **Long press menu** – Press and hold a message to open a popup: Hide / Unhide, Fold / Unfold, Delete, Cancel. Delete works like SillyTavern's built-in "Delete this message", without opening the edit window first.

<img width="1036" height="342" alt="화면 캡처 2026-10-21 175858" src="https://github.com/user-attachments/assets/4a2e4877-163e-4294-b0c1-9d67a72ca902" />
<img width="701" height="326" alt="화면 캡처 2026-10-21 180244" src="https://github.com/user-attachments/assets/12c3f55a-bbd3-4344-9bf9-2477941c8a05" />
<img width="1046" height="348" alt="화면 캡처 2026-10-21 180300" src="https://github.com/user-attachments/assets/cd8b9db7-df7b-46d1-b51f-af53289f572b" />

* **Selected text menu** – Select text inside a message, then press and hold to open a popup: Edit selection, Delete selection, Cancel.
* **Replace all** – If the selected text appears more than once in the message, Edit selection shows a "Replace all" checkbox. Every occurrence in that message is replaced at once.
* **`/fold` and `/unfold` commands** – Work like `/hide`, with a message index or a range.
  * `/fold 3` : message 3
  * `/fold 2-5` : messages 2 to 5
  * `/fold 4-` : message 4 to the last message
* **Link Hide & Fold** – Hiding a message also folds it, and unhiding it also unfolds it. This applies to `/hide`, `/unhide`, the built-in hide icon and the long press popup.
* **Auto Fold & Hide Comments** – Messages created by slash commands, such as `/comment` and `/sendas`, are folded and/or hidden automatically. Normal chat replies are not affected.

## Optional Settings

Open the Extensions panel and select **Message Fold & Delete**.

**Hide & Fold**

* **Link Hide & Fold** – Turns the link on or off. When on, one of the following can be selected.
  * **Keep Fold button** – Fold and Unfold remain as separate buttons.
  * **Replace Fold button** – Hide and Fold are merged into a single "Hide & Fold" (or "Unhide & Unfold") button. The separate fold icon is removed from the message actions.

**Auto Fold & Hide Comments**

* **Auto-fold** – Folds the target messages as soon as they appear. The bar stays tinted until it is opened for the first time.
* **Auto-hide** – Hides the target messages, so that they are left out of the prompt.

## Customization

Add the following to Custom CSS if needed.

```css
:root {
    --mf-min-height: 40px;   /* minimum height of a folded bar */
    --mf-gap: 6px;           /* gap between folded bars */
    --mf-tint-alpha: 20%;    /* strength of the tint on unopened auto-folded bars */
    --mf-tint-color: #4aa;   /* tint color (default: --SmartThemeQuoteColor) */
}
```

## Notes

* Text is matched against the message's saved source. Text that differs on screen (macros such as {{user}}, regex scripts) and selections that span multiple paragraphs may not be found. In that case a warning is shown and nothing is changed.
* "Replace all" is case-sensitive and searches the whole saved message, including parts not visible on screen such as markdown marks.
* Automatic processing is applied once per message. A message that is unfolded or unhidden manually is not processed again.
* When an auto option is turned on, matching messages already in the current chat are processed as well.
* Auto Fold & Hide targets are identified by the saved message data (`model` is `slash command`, or `type` is `comment`).
* On some mobile browsers, the browser's own long press behavior may take priority over the selected text menu.

<br><br><br><br>

# Message Fold and Delete

메시지를 한 줄 바로 접고, 길게 눌러서 메시지나 선택한 글자를 관리하는 SillyTavern 확장입니다.

## 주요 기능

<img width="1053" height="411" alt="화면 캡처 2026-10-21 175828" src="https://github.com/user-attachments/assets/f89acdad-bbed-47e8-8ac7-21666090124d" />

* **접기 / 펼치기** – 메시지 액션 버튼의 접기 아이콘을 누르면 메시지가 얇은 바로 접힙니다. 접기 아이콘은 메시지 액션의 가장 왼쪽에 있습니다.
* **미리보기** – 접힌 바를 누르면 임시로 펼쳐지고, 다른 곳을 누르면 다시 접힙니다. 접힘을 완전히 해제하려면 펼치기 아이콘을 누릅니다.

<img width="651" height="275" alt="화면 캡처 2026-10-21 175751" src="https://github.com/user-attachments/assets/d329bf1c-bead-48cb-b85b-619a9e39f9f6" />

* **길게 누르기 메뉴** – 메시지를 길게 누르면 팝업이 표시됩니다: Hide / Unhide, Fold / Unfold, Delete, Cancel. Delete는 SillyTavern 기본 "메시지 삭제"와 동일하게 동작하며, 편집 창을 먼저 열 필요가 없습니다.

<img width="1036" height="342" alt="화면 캡처 2026-10-21 175858" src="https://github.com/user-attachments/assets/4a2e4877-163e-4294-b0c1-9d67a72ca902" />
<img width="701" height="326" alt="화면 캡처 2026-10-21 180244" src="https://github.com/user-attachments/assets/12c3f55a-bbd3-4344-9bf9-2477941c8a05" />
<img width="1046" height="348" alt="화면 캡처 2026-10-21 180300" src="https://github.com/user-attachments/assets/cd8b9db7-df7b-46d1-b51f-af53289f572b" />

* **선택한 글자 메뉴** – 메시지 안의 글자를 선택한 뒤 길게 누르면 팝업이 표시됩니다: Edit selection, Delete selection, Cancel.
* **모두 바꾸기** – 선택한 글자가 메시지 안에 여러 번 있으면 Edit selection 창에 "Replace all" 체크박스가 표시됩니다. 해당 메시지 안의 모든 일치 항목이 한 번에 바뀝니다.
* **`/fold`, `/unfold` 명령어** – `/hide`와 같은 방식으로 메시지 번호 또는 범위를 지정합니다.
  * `/fold 3` : 3번 메시지
  * `/fold 2-5` : 2번부터 5번까지
  * `/fold 4-` : 4번부터 마지막 메시지까지
* **Hide & Fold 연동** – 메시지를 숨기면 함께 접히고, 숨김을 해제하면 함께 펼쳐집니다. `/hide`, `/unhide`, 기본 숨김 아이콘, 길게 누르기 팝업에 모두 적용됩니다.
* **코멘트 자동 접기 및 숨기기** – `/comment`, `/sendas` 등 슬래시 명령어로 생성된 메시지를 자동으로 접거나 숨깁니다. 일반 채팅 답변에는 적용되지 않습니다.

## 추가 설정

확장 패널에서 **Message Fold & Delete**를 선택합니다.

**Hide & Fold**

* **Link Hide & Fold** – 연동을 켜고 끕니다. 켜면 아래 중 하나를 선택할 수 있습니다.
  * **Keep Fold button** – Fold, Unfold 버튼을 그대로 유지합니다.
  * **Replace Fold button** – Hide와 Fold를 "Hide & Fold"(또는 "Unhide & Unfold") 버튼 하나로 합칩니다. 메시지 액션의 별도 접기 아이콘은 제거됩니다.

**Auto Fold & Hide Comments**

* **Auto-fold** – 대상 메시지를 생성 즉시 접습니다. 처음 열기 전까지 바에 색이 덧입혀져 표시됩니다.
* **Auto-hide** – 대상 메시지를 숨겨 프롬프트에서 제외합니다.

## 사용자 설정

필요한 경우 Custom CSS에 다음을 추가합니다.

```css
:root {
    --mf-min-height: 40px;   /* 접힌 바의 최소 높이 */
    --mf-gap: 6px;           /* 접힌 바 사이 간격 */
    --mf-tint-alpha: 20%;    /* 열어보지 않은 자동 접힘 바의 색 덧입힘 진하기 */
    --mf-tint-color: #4aa;   /* 덧입힘 색 (기본값: --SmartThemeQuoteColor) */
}
```

## 참고 사항

* 화면에 보이는 글자를 저장된 원문에서 찾아 바꾸므로, 매크로({{user}})나 정규식으로 화면과 원문이 달라진 부분과 여러 문단에 걸친 선택은 찾지 못할 수 있습니다. 이 경우 안내 메시지가 표시되고 아무것도 바뀌지 않습니다.
* "모두 바꾸기"는 대소문자를 구분하며, 마크다운 표시처럼 화면에 보이지 않는 부분을 포함해 저장된 메시지 전체에서 찾습니다.
* 자동 처리는 메시지마다 한 번만 적용됩니다. 직접 펼치거나 숨김을 해제한 메시지는 다시 처리되지 않습니다.
* 자동 옵션을 켜면 현재 채팅에 이미 있는 대상 메시지도 함께 처리됩니다.
* 자동 처리 대상은 저장된 메시지 데이터로 판별합니다 (`model`이 `slash command`이거나 `type`이 `comment`인 메시지).
* 일부 모바일 브라우저에서는 브라우저 자체의 길게 누르기 동작이 먼저 실행되어 선택한 글자 메뉴가 표시되지 않을 수 있습니다.
