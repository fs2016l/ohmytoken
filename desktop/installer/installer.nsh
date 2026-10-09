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

; 在新安装器和旧卸载器两个入口检查当前安装目录。用户更换安装位置后，
; 如果自选回放目录因此落入清理范围，就在任何文件替换前停止。
!macro AgentProtectReplayLocation
  Push $R5
  Push $R6
  Push $R7
  ClearErrors
  FileOpen $R7 "$APPDATA\ohmytoken\replay-storage-location.txt" r
  ${IfNot} ${Errors}
    ClearErrors
    FileReadUTF16LE $R7 $R6
    ${If} ${Errors}
      FileClose $R7
      DetailPrint "Cannot read replay storage location"
      SetErrorLevel 2
      Quit
    ${EndIf}
    FileClose $R7
    StrLen $R7 $R6
    ${If} $R7 < 2
      DetailPrint "Invalid replay storage location"
      SetErrorLevel 2
      Quit
    ${EndIf}
    IntOp $R7 $R7 - 2
    StrCpy $R5 $R6 2 $R7
    ${If} $R5 != "$\r$\n"
      DetailPrint "Invalid replay storage location"
      SetErrorLevel 2
      Quit
    ${EndIf}
    StrCpy $R6 $R6 $R7
    ${If} $R6 != ""
      StrLen $R7 "$INSTDIR"
      StrCpy $R5 $R6 $R7
      ${If} $R5 == "$INSTDIR"
        StrCpy $R5 $R6 1 $R7
        ${If} $R5 == ""
        ${OrIf} $R5 == "\"
          DetailPrint "Replay storage is inside the installation directory; aborting"
          ${IfNot} ${Silent}
            MessageBox MB_OK|MB_ICONEXCLAMATION "生成历史存储位置位于安装目录内。请另选安装位置或回放目录。$\r$\nReplay storage is inside the installation directory. Choose another location."
          ${EndIf}
          SetErrorLevel 2
          Quit
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R7
  Pop $R6
  Pop $R5
!macroend

; electron-builder 默认会尝试通过 PowerShell/taskkill 自动结束正在运行的应用，
; 甚至在等待后强制终止。更新时不允许安装器这样做：先给应用自身退出的
; 宽限时间；如果仍有主程序进程，只能由用户手动退出后重试，或取消安装。
; CHECK_APP_RUNNING 位于旧版卸载和新文件写入之前，因此应用仍在运行时
; 不会提前进入破坏旧版本的文件替换阶段。
!macro customCheckAppRunning
  !insertmacro AgentProtectReplayLocation
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

; 覆盖更新会先运行旧卸载器并清空安装目录。只暂存当前安装目录的回放，
; 新安装器完成文件安装后立即恢复；不读取旧版 userData/replays 历史。
; 手动卸载时暂存目录保留，重新安装时恢复；--delete-app-data 会将其删除。
!macro customUnInstall
  !insertmacro AgentProtectReplayLocation
  Push $R8
  Push $R9

  ${If} ${FileExists} "$INSTDIR\replays\*.*"
    CreateDirectory "$APPDATA\ohmytoken\replay-upgrade-backup"
    FindFirst $R8 $R9 "$INSTDIR\replays\*.*"
    ${While} $R9 != ""
      ${If} $R9 != "."
      ${AndIf} $R9 != ".."
        ${If} ${FileExists} "$APPDATA\ohmytoken\replay-upgrade-backup\$R9"
          DetailPrint "Replay backup already exists: $R9"
          SetErrorLevel 2
          Quit
        ${Else}
          ClearErrors
          Rename "$INSTDIR\replays\$R9" "$APPDATA\ohmytoken\replay-upgrade-backup\$R9"
          ${If} ${Errors}
            ; 跨盘时复制；失败则中止卸载，保留安装目录中的原文件。
            ClearErrors
            CopyFiles /SILENT "$INSTDIR\replays\$R9" "$APPDATA\ohmytoken\replay-upgrade-backup"
            ${If} ${Errors}
              Delete "$APPDATA\ohmytoken\replay-upgrade-backup\$R9"
              RMDir /r "$APPDATA\ohmytoken\replay-upgrade-backup\$R9"
              DetailPrint "Cannot back up replay: $R9"
              SetErrorLevel 2
              Quit
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      FindNext $R8 $R9
    ${EndWhile}
    FindClose $R8
  ${EndIf}

  Pop $R9
  Pop $R8
!macroend

!ifndef BUILD_UNINSTALLER

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

  Push $R8
  Push $R9
  ${If} ${FileExists} "$APPDATA\ohmytoken\replay-upgrade-backup\*.*"
    CreateDirectory "$INSTDIR\replays"
    FindFirst $R8 $R9 "$APPDATA\ohmytoken\replay-upgrade-backup\*.*"
    ${While} $R9 != ""
      ${If} $R9 != "."
      ${AndIf} $R9 != ".."
        ${If} ${FileExists} "$INSTDIR\replays\$R9"
          DetailPrint "Replay restore destination already exists: $R9"
          SetErrorLevel 2
          Quit
        ${Else}
          ClearErrors
          Rename "$APPDATA\ohmytoken\replay-upgrade-backup\$R9" "$INSTDIR\replays\$R9"
          ${If} ${Errors}
            ClearErrors
            CopyFiles /SILENT "$APPDATA\ohmytoken\replay-upgrade-backup\$R9" "$INSTDIR\replays"
            ${If} ${Errors}
              Delete "$INSTDIR\replays\$R9"
              RMDir /r "$INSTDIR\replays\$R9"
              DetailPrint "Cannot restore replay: $R9"
              SetErrorLevel 2
              Quit
            ${Else}
              Delete "$APPDATA\ohmytoken\replay-upgrade-backup\$R9"
              RMDir /r "$APPDATA\ohmytoken\replay-upgrade-backup\$R9"
              ${If} ${FileExists} "$APPDATA\ohmytoken\replay-upgrade-backup\$R9"
                DetailPrint "Cannot remove replay backup after restore: $R9"
                SetErrorLevel 2
                Quit
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      FindNext $R8 $R9
    ${EndWhile}
    FindClose $R8
    RMDir "$APPDATA\ohmytoken\replay-upgrade-backup"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend

!define AGENT_TERMS_URL "https://ohmytoken.net/legal/agent-terms"
!define AGENT_PRIVACY_URL "https://ohmytoken.net/legal/agent-privacy"

!macro customPageAfterChangeDir
  Page custom AgentLegalPageCreate AgentLegalPageLeave
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
