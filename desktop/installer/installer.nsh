!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER

Var AgentLegalCheckbox
Var AgentTermsLink
Var AgentPrivacyLink

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

  ${NSD_CreateLabel} 0 0 100% 14u "安装并使用 Oh My Token Agent 前，请阅读以下两份在线文档。"
  Pop $0

  ${NSD_CreateCheckbox} 0 34u 12u 14u ""
  Pop $AgentLegalCheckbox
  ${NSD_OnClick} $AgentLegalCheckbox AgentLegalSelectionChanged

  ${NSD_CreateLabel} 17u 34u 60u 14u "我已阅读并同意"
  Pop $0

  ${NSD_CreateLink} 77u 34u 84u 14u "《Agent 用户协议》"
  Pop $AgentTermsLink
  ${NSD_OnClick} $AgentTermsLink OpenAgentTerms

  ${NSD_CreateLabel} 161u 34u 12u 14u "和"
  Pop $0

  ${NSD_CreateLink} 173u 34u 88u 14u "《Agent 隐私政策》"
  Pop $AgentPrivacyLink
  ${NSD_OnClick} $AgentPrivacyLink OpenAgentPrivacy

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
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先阅读并同意 Agent 用户协议和 Agent 隐私政策。"
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
