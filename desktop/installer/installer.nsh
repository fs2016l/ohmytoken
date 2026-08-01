!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER

Var AgentTermsCheckbox
Var AgentPrivacyCheckbox
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

  ${NSD_CreateLabel} 0 0 100% 30u "安装并使用 Oh My Token Agent 前，请分别阅读并同意以下两份在线文档。两个选项默认不勾选。"
  Pop $0

  ${NSD_CreateCheckbox} 0 38u 100% 14u "我已阅读并同意《Oh My Token Agent 用户协议》"
  Pop $AgentTermsCheckbox
  ${NSD_OnClick} $AgentTermsCheckbox AgentLegalSelectionChanged

  ${NSD_CreateLink} 17u 56u 55% 12u "查看 Agent 用户协议"
  Pop $AgentTermsLink
  ${NSD_OnClick} $AgentTermsLink OpenAgentTerms

  ${NSD_CreateCheckbox} 0 80u 100% 14u "我已阅读并同意《Oh My Token Agent 隐私政策》"
  Pop $AgentPrivacyCheckbox
  ${NSD_OnClick} $AgentPrivacyCheckbox AgentLegalSelectionChanged

  ${NSD_CreateLink} 17u 98u 55% 12u "查看 Agent 隐私政策"
  Pop $AgentPrivacyLink
  ${NSD_OnClick} $AgentPrivacyLink OpenAgentPrivacy

  ${NSD_CreateLabel} 0 124u 100% 34u "说明：Agent 的套餐、智能体下载和 AI 信息差当前无需登录；注册普通账号时适用另外的账号服务协议与账号隐私政策。"
  Pop $0

  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 0

  nsDialogs::Show
FunctionEnd

Function AgentLegalSelectionChanged
  ${NSD_GetState} $AgentTermsCheckbox $0
  ${NSD_GetState} $AgentPrivacyCheckbox $1
  GetDlgItem $2 $HWNDPARENT 1

  ${If} $0 == ${BST_CHECKED}
  ${AndIf} $1 == ${BST_CHECKED}
    EnableWindow $2 1
  ${Else}
    EnableWindow $2 0
  ${EndIf}
FunctionEnd

Function AgentLegalPageLeave
  ${NSD_GetState} $AgentTermsCheckbox $0
  ${If} $0 != ${BST_CHECKED}
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先阅读并同意 Agent 用户协议。"
    Abort
  ${EndIf}

  ${NSD_GetState} $AgentPrivacyCheckbox $0
  ${If} $0 != ${BST_CHECKED}
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先阅读并同意 Agent 隐私政策。"
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
