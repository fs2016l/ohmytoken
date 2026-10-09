!ifndef AGENT_SHORTCUT_ICONS_INCLUDED
!define AGENT_SHORTCUT_ICONS_INCLUDED

!include "LogicLib.nsh"
!include "Win\COM.nsh"
!include "${BUILD_RESOURCES_DIR}\windows-shortcut-icon.nsh"

; Input: expected executable path, then existing .lnk path. Output: HRESULT (S_FALSE
; when absent or redirected by the user). Load and change only IconLocation so
; custom arguments, AUMI, launch settings and the shortcut identity survive updates.
Function AgentRefreshShortcutIcon
  System::Store S
  Pop $9
  Pop $8
  StrCpy $0 1
  StrCpy $1 0
  StrCpy $2 0
  StrCpy $3 -1

  ${If} $9 != ""
  ${AndIf} ${FileExists} "$9"
  ${AndIf} ${FileExists} "$INSTDIR\${AGENT_SHORTCUT_ICON_RELATIVE}"
    ; Never follow a replaced shortcut file through a symbolic link.
    System::Call 'kernel32::GetFileAttributesW(w "$9") i.r4'
    IntOp $4 $4 & 0x410 ; FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT
    ${If} $4 == 0
      System::Call 'ole32::CoInitializeEx(p 0, i 2) i.r3' ; COINIT_APARTMENTTHREADED
      ${If} $3 >= 0
      ${OrIf} $3 = 0x80010106 ; RPC_E_CHANGED_MODE: COM already uses another apartment
        !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLinkW} r1 .r0
        ${If} $0 == 0
          ${IUnknown::QueryInterface} $1 '("${IID_IPersistFile}",.r2).r0'
          ${If} $0 == 0
            ${IPersistFile::Load} $2 '("$9",0).r0'
            ${If} $0 == 0
              ${IShellLink::GetPath} $1 '(.r4,${NSIS_MAX_STRLEN},0,0).r0'
              ${If} $0 == 0
                ${If} $4 == $8
                  ${IShellLink::SetIconLocation} $1 '("$INSTDIR\${AGENT_SHORTCUT_ICON_RELATIVE}",0).r0'
                  ${If} $0 == 0
                    ${IPersistFile::Save} $2 '("$9",1).r0'
                    ${If} $0 == 0
                      ; SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSHNOWAIT.
                      ; Notify only this changed shortcut, without clearing user caches.
                      System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x3005, w "$9", p 0)'
                    ${EndIf}
                  ${EndIf}
                ${Else}
                  StrCpy $0 1
                ${EndIf}
              ${EndIf}
            ${EndIf}
            ${IUnknown::Release} $2 ''
          ${EndIf}
          ${IUnknown::Release} $1 ''
        ${EndIf}
      ${Else}
        StrCpy $0 $3
      ${EndIf}
      ${If} $3 >= 0
        ; Both S_OK and S_FALSE must be balanced; failed initialization must not.
        System::Call 'ole32::CoUninitialize()'
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${If} $0 < 0
    IntFmt $4 "0x%08X" $0
    DetailPrint "Could not refresh shortcut icon: $9 ($4)"
  ${EndIf}
  Push $0
  System::Store L
FunctionEnd

; electron-builder invokes customInstall after shortcut creation, including its
; keepShortcuts upgrade path. Missing shortcuts stay missing.
!macro AgentRefreshApplicationShortcuts
  Push $0
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    Push "$appExe"
    Push "$newStartMenuLink"
    Call AgentRefreshShortcutIcon
    Pop $0
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    Push "$appExe"
    Push "$newDesktopLink"
    Call AgentRefreshShortcutIcon
    Pop $0
  !endif
  Pop $0
!macroend

!endif
