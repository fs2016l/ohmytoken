!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifdef DELETE_APP_DATA_ON_UNINSTALL
  !error "Safe uninstall must preserve application data."
!endif

; One set of functions for the installer, another for its separately built uninstaller.
!ifdef BUILD_UNINSTALLER
  !define AGENT_SAFETY_PREFIX "un."
!else
  !define AGENT_SAFETY_PREFIX ""
!endif

Function ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  DetailPrint "Unsafe or unowned installation path; no recursive deletion will be performed."
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONSTOP "安装目录无法安全验证，请使用独立的 Oh My Token 文件夹。用户文件将予以保留。$\r$\nThe installation directory could not be verified safely. Use a dedicated Oh My Token folder. User files are preserved."
  ${EndIf}
  SetErrorLevel 2
  Quit
FunctionEnd

; Check every existing ancestor, including the leaf. Do not traverse junctions/symlinks.
; The only accepted syntax is a normal absolute Windows drive path.
Function ${AGENT_SAFETY_PREFIX}AgentCheckPath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $1 $0 1 1
  StrCpy $2 $0 1 2
  ${If} $1 != ":"
  ${OrIf} $2 != "\"
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i .r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  StrCpy $0 $1
  ${GetRoot} "$0" $3
  StrCpy $3 "$3\"
  System::Call 'kernel32::GetDriveTypeW(w r3) i .r2'
  ${If} $2 < 2
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w r0) i .r2 ?e'
    Pop $4
    ${If} $2 == -1
      ${If} $4 != 2
      ${AndIf} $4 != 3
        Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
      ${EndIf}
    ${Else}
      IntOp $2 $2 & 0x400
      ${If} $2 != 0
        Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
      ${EndIf}
    ${EndIf}
    ${If} $0 == $3
      ${ExitDo}
    ${EndIf}
    ${GetParent} "$0" $1
    ${If} $1 == ""
    ${OrIf} $1 == $0
      Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
    ${EndIf}
    StrCpy $0 $1
    ; GetParent returns C: for a direct child of the drive root.
    StrLen $2 $0
    ${If} $2 == 2
      StrCpy $0 "$0\"
    ${EndIf}
  ${Loop}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro AgentNormalizeInstallDirectory
  Push $0
  Push $1
  StrCpy $0 $INSTDIR
  ; NSIS strips the final backslash from $INSTDIR, including a selected drive root.
  ; Restore it in an ordinary register instead of resolving a drive-relative path.
  StrLen $1 $0
  ${If} $1 == 2
    StrCpy $1 $0 1 1
    ${If} $1 == ":"
      StrCpy $0 "$0\"
    ${EndIf}
  ${EndIf}
  ; Reject relative paths before normalization could turn them into an absolute path.
  StrCpy $1 $0 1 1
  ${If} $1 != ":"
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  StrCpy $1 $0 1 2
  ${If} $1 != "\"
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i .r0'
  ${If} $0 == 0
  ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  StrCpy $INSTDIR $1
  ${Do}
    StrLen $0 $INSTDIR
    ${If} $0 <= 3
      ${ExitDo}
    ${EndIf}
    StrCpy $0 $INSTDIR 1 -1
    ${If} $0 != "\"
      ${ExitDo}
    ${EndIf}
    StrCpy $INSTDIR $INSTDIR -1
  ${Loop}
  Pop $1
  Pop $0
!macroend

!macro AgentValidateInstallDirectory
  !insertmacro AgentNormalizeInstallDirectory
  Push $0
  Push $1
  StrLen $1 $INSTDIR
  ${If} $1 <= 3
  ${OrIf} $INSTDIR == $PROGRAMFILES
  ${OrIf} $INSTDIR == $PROGRAMFILES32
  ${OrIf} $INSTDIR == $PROGRAMFILES64
  ${OrIf} $INSTDIR == $COMMONFILES
  ${OrIf} $INSTDIR == $PROFILE
  ${OrIf} $INSTDIR == $APPDATA
  ${OrIf} $INSTDIR == $LOCALAPPDATA
  ${OrIf} $INSTDIR == $DESKTOP
  ${OrIf} $INSTDIR == $TEMP
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  StrLen $1 $WINDIR
  StrCpy $0 $INSTDIR $1
  ${If} $0 == $WINDIR
    StrCpy $0 $INSTDIR 1 $1
    ${If} $0 == ""
    ${OrIf} $0 == "\"
      Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
    ${EndIf}
  ${EndIf}
  Push "$INSTDIR"
  Call ${AGENT_SAFETY_PREFIX}AgentCheckPath
  Pop $1
  Pop $0
!macroend

!macro AgentCheckInstalledFile RELATIVE_PATH
  Push "$INSTDIR\${RELATIVE_PATH}"
  Call ${AGENT_SAFETY_PREFIX}AgentCheckPath
!macroend

Function ${AGENT_SAFETY_PREFIX}AgentRequireOwnership
  Push $0
  Push $1
  ClearErrors
  FileOpen $0 "$INSTDIR\.ohmytoken-installation" r
  ${If} ${Errors}
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  FileReadUTF16LE $0 $1
  ${If} $1 != "${APP_ID}$\r$\n"
    FileClose $0
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  FileReadUTF16LE $0 $1
  FileClose $0
  ${If} $1 != "$INSTDIR$\r$\n"
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

!macro AgentProtectUninstall
  !insertmacro AgentValidateInstallDirectory
  Push $0
  Push $1
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    ; No blanket deletion of app data, which could itself contain directory junctions.
    Call ${AGENT_SAFETY_PREFIX}AgentUnsafePath
  ${EndIf}
  Push "$INSTDIR\.ohmytoken-installation"
  Call ${AGENT_SAFETY_PREFIX}AgentCheckPath
  Call ${AGENT_SAFETY_PREFIX}AgentRequireOwnership
  Pop $1
  Pop $0
!macroend

!ifndef BUILD_UNINSTALLER
  !macro AgentPrepareInstallation
    !insertmacro AgentNormalizeInstallDirectory
    Push $0
    Push $1
    ; Require the final component, not a substring somewhere in a parent directory.
    ${GetFileName} "$INSTDIR" $0
    ${If} $0 != "${APP_FILENAME}"
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}
    !insertmacro AgentValidateInstallDirectory
    ${If} ${FileExists} "$INSTDIR\.ohmytoken-installation"
      Push "$INSTDIR\.ohmytoken-installation"
      Call AgentCheckPath
      Call AgentRequireOwnership
    ${Else}
      FindFirst $0 $1 "$INSTDIR\*.*"
      ${While} $1 != ""
        ${If} $1 != "."
        ${AndIf} $1 != ".."
          FindClose $0
          Call AgentUnsafePath
        ${EndIf}
        FindNext $0 $1
      ${EndWhile}
      FindClose $0
    ${EndIf}
    !insertmacro AgentPreflightInstalledFiles
    Pop $1
    Pop $0
  !macroend

  !macro AgentWriteInstallationMarker
    Push $0
    ClearErrors
    FileOpen $0 "$INSTDIR\.ohmytoken-installation" w
    ${If} ${Errors}
      Call AgentUnsafePath
    ${EndIf}
    FileWriteUTF16LE $0 "${APP_ID}$\r$\n$INSTDIR$\r$\n"
    FileClose $0
    ${If} ${Errors}
      Call AgentUnsafePath
    ${EndIf}
    Pop $0
  !macroend
!else
  !macro AgentDeleteInstalledFile RELATIVE_PATH
    !insertmacro AgentCheckInstalledFile "${RELATIVE_PATH}"
    ${If} ${FileExists} "$INSTDIR\${RELATIVE_PATH}"
      ClearErrors
      Delete "$INSTDIR\${RELATIVE_PATH}"
      ${If} ${Errors}
        DetailPrint "Cannot remove installed file: ${RELATIVE_PATH}"
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
  !macroend

  !macro AgentRemoveInstalledDirectory RELATIVE_PATH
    !insertmacro AgentCheckInstalledFile "${RELATIVE_PATH}"
    ; An unknown file makes RMDir fail harmlessly. Never recurse or use wildcards.
    RMDir "$INSTDIR\${RELATIVE_PATH}"
  !macroend

  !macro AgentRemoveInstallationRoot
    Push $0
    Push $1
    Push $2
    StrCpy $2 0
    FindFirst $0 $1 "$INSTDIR\*.*"
    ${While} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
      ${AndIf} $1 != ".ohmytoken-installation"
        StrCpy $2 1
      ${EndIf}
      FindNext $0 $1
    ${EndWhile}
    FindClose $0
    ; Preserve ownership when user data remains, so a later reinstall is safe.
    ${If} $2 == 0
      !insertmacro AgentDeleteInstalledFile ".ohmytoken-installation"
      SetOutPath "$TEMP"
      RMDir "$INSTDIR"
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  !macroend

  !macro customRemoveFiles
    !insertmacro AgentProtectUninstall
    !insertmacro AgentRemoveInstalledFiles
  !macroend
!endif

!include "${BUILD_RESOURCES_DIR}\windows-uninstall-files.nsh"
