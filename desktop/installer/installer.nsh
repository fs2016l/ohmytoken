!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef MUI_LANGDLL_WINDOWTITLE
  !define MUI_LANGDLL_WINDOWTITLE "Language / 界面语言"
!endif
!ifndef MUI_LANGDLL_INFO
  !define MUI_LANGDLL_INFO "Please choose your language.$\r$\n请选择界面语言。"
!endif
!ifndef MUI_LANGDLL_ALLLANGUAGES
  !define MUI_LANGDLL_ALLLANGUAGES
!endif

!include "${PROJECT_DIR}\installer\safe-installation.nsh"

; electron-builder 默认会尝试通过 PowerShell/taskkill 自动结束正在运行的应用，
; 甚至在等待后强制终止。更新时不允许安装器这样做：先给应用自身退出的
; 宽限时间；如果仍有主程序进程，只能由用户手动退出后重试，或取消安装。
; CHECK_APP_RUNNING 位于旧版卸载和新文件写入之前，因此应用仍在运行时
; 不会提前进入破坏旧版本的文件替换阶段。
!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    !insertmacro AgentProtectUninstall
  !else
    !insertmacro AgentPrepareInstallation
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !endif
  StrCpy $R1 0

  AgentWaitForAppExit:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 0
      Goto AgentAppExited
    ${EndIf}

    ; 自动更新会先启动安装器，再让 Electron 发起 app.quit()。
    ; 最多等待 5 秒，正常退出时无需打扰用户。
    IntOp $R1 $R1 + 1
    ${If} $R1 <= 10
      Sleep 500
      Goto AgentWaitForAppExit
    ${EndIf}

    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY AgentRetryAppExit
    Quit

  AgentRetryAppExit:
    StrCpy $R1 0
    Goto AgentWaitForAppExit

  AgentAppExited:
!macroend

!macro customUnInit
  !insertmacro AgentProtectUninstall
!macroend

!ifndef BUILD_UNINSTALLER

; Silent all-users installation selects its mode again after customInit. Do not allow
; that step to replace a safe derived subdirectory with an unsafe raw /D argument.
!macro customInit
  ${If} ${Silent}
    Push $0
    Push "$INSTDIR"
    !insertmacro AgentPrepareInstallation
    Pop $0
    !ifdef INSTALL_MODE_PER_ALL_USERS
      ${If} $0 != $INSTDIR
        Call AgentUnsafePath
      ${EndIf}
    !else
      ${If} $hasPerMachineInstallation == "1"
      ${AndIf} $0 != $INSTDIR
        Call AgentUnsafePath
      ${EndIf}
    !endif
    Pop $0
  ${EndIf}
!macroend

Function AgentBeforeInstallFiles
  ; Assisted elevated instances skip CHECK_APP_RUNNING; guard the final directory here too.
  !ifdef allowToChangeInstallationDirectory
    Call instFilesPre
  !endif
  !insertmacro AgentPrepareInstallation
FunctionEnd

Var AgentLegalCheckbox
Var AgentTermsLink
Var AgentPrivacyLink

LangString AgentLegalIntro 1033 "Before installing and using Oh My Token, please read these two documents."
LangString AgentLegalIntro 2052 "安装并使用 Oh My Token 前，请阅读以下两份在线文档。"
LangString AgentLegalTerms 1033 "Agent Terms of Use"
LangString AgentLegalTerms 2052 "《Agent 用户协议》"
LangString AgentLegalPrivacy 1033 "Agent Privacy Policy"
LangString AgentLegalPrivacy 2052 "《Agent 隐私政策》"
LangString AgentLegalAccept 1033 "I have read and agree to the Agent Terms of Use and Agent Privacy Policy."
LangString AgentLegalAccept 2052 "我已阅读并同意《Agent 用户协议》和《Agent 隐私政策》。"
LangString AgentLegalRequired 1033 "Please read and accept the Agent Terms of Use and Agent Privacy Policy first."
LangString AgentLegalRequired 2052 "请先阅读并同意 Agent 用户协议和 Agent 隐私政策。"

; Persist the selected installer language alongside the app. It is only a first-run hint;
; application upgrades never overwrite an existing language or currency preference.
!macro customInstall
  ClearErrors
  FileOpen $0 "$INSTDIR\resources\installation-language" w
  ${IfNot} ${Errors}
    ${If} $LANGUAGE == 2052
      FileWrite $0 "zh"
    ${Else}
      FileWrite $0 "en"
    ${EndIf}
    FileClose $0
  ${EndIf}

  !insertmacro AgentWriteInstallationMarker
!macroend

!define AGENT_TERMS_URL "https://ohmytoken.net/legal/agent-terms"
!define AGENT_PRIVACY_URL "https://ohmytoken.net/legal/agent-privacy"

!macro customPageAfterChangeDir
  Page custom AgentLegalPageCreate AgentLegalPageLeave
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE AgentBeforeInstallFiles
!macroend

Function AgentLegalPageCreate
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--updated" $1
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "$(AgentLegalIntro)"
  Pop $0

  ${NSD_CreateLink} 0 38u 100% 14u "$(AgentLegalTerms)"
  Pop $AgentTermsLink
  ${NSD_OnClick} $AgentTermsLink OpenAgentTerms

  ${NSD_CreateLink} 0 58u 100% 14u "$(AgentLegalPrivacy)"
  Pop $AgentPrivacyLink
  ${NSD_OnClick} $AgentPrivacyLink OpenAgentPrivacy

  ${NSD_CreateCheckbox} 0 88u 100% 28u "$(AgentLegalAccept)"
  Pop $AgentLegalCheckbox
  ${NSD_OnClick} $AgentLegalCheckbox AgentLegalSelectionChanged

  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 0

  nsDialogs::Show
FunctionEnd

Function AgentLegalSelectionChanged
  ${NSD_GetState} $AgentLegalCheckbox $0
  GetDlgItem $2 $HWNDPARENT 1

  ${If} $0 == ${BST_CHECKED}
    EnableWindow $2 1
  ${Else}
    EnableWindow $2 0
  ${EndIf}
FunctionEnd

Function AgentLegalPageLeave
  ${NSD_GetState} $AgentLegalCheckbox $0
  ${If} $0 != ${BST_CHECKED}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(AgentLegalRequired)"
    Abort
  ${EndIf}
FunctionEnd

Function OpenAgentTerms
  ExecShell "open" "${AGENT_TERMS_URL}"
FunctionEnd

Function OpenAgentPrivacy
  ExecShell "open" "${AGENT_PRIVACY_URL}"
FunctionEnd

!endif
