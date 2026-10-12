Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!ifndef PAYLOAD
  !error "PAYLOAD required"
!endif
Name "Atlas WPS 数据助手"
OutFile "..\release\AtlasWpsSetup-0.4.1-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\AtlasWps"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "0.4.1.0"
VIAddVersionKey /LANG=2052 "ProductName" "Atlas WPS 数据助手"
VIAddVersionKey /LANG=2052 "FileDescription" "Atlas WPS 数据助手安装包"
VIAddVersionKey /LANG=2052 "FileVersion" "0.4.1"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Eureka Atlas"
Var OriginInput
Var Origin
Var AutostartInput
Var Autostart
!define MUI_WELCOMEPAGE_TITLE "安装 Atlas WPS 数据助手"
!define MUI_ICON "${PAYLOAD}\atlas-badge.ico"
!define MUI_UNICON "${PAYLOAD}\atlas-badge.ico"
!define MUI_WELCOMEPAGE_TEXT "请先保存文件并完全退出 WPS。$\r$\n$\r$\n此安装包仅安装当前用户的 Atlas 加载项和本地助手，不安装服务器或数据库，不修改 WPS 安装目录。$\r$\n$\r$\n本机试用需保持 Atlas API 运行；用户不需要安装 Node.js 或 pnpm。$\r$\n$\r$\n本版未签名，请仅运行可信来源的安装包。"
!insertmacro MUI_PAGE_WELCOME
Page custom OriginPage OriginLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "请重新打开 WPS 表格 → Atlas → 打开助手。$\r$\n$\r$\n系统托盘中的本地助手必须保持运行；登录和查询由配置的 Atlas 服务提供。"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动 Atlas 本地助手"
!define MUI_FINISHPAGE_RUN_FUNCTION StartAtlas
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "本安装包需要 64 位 Windows。"
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "本安装包需要 Windows 10 或 11。"
    Abort
  ${EndIf}
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
  ${If} $0 < 528040
    MessageBox MB_ICONSTOP "请先通过微软官方渠道安装 .NET Framework 4.8，再运行本安装包。"
    Abort
  ${EndIf}
  StrCpy $Origin "http://127.0.0.1:3001"
  IfFileExists "$INSTDIR\atlas-origin.txt" 0 +4
    FileOpen $0 "$INSTDIR\atlas-origin.txt" r
    FileRead $0 $Origin
    FileClose $0
FunctionEnd

Function OriginPage
  !insertmacro MUI_HEADER_TEXT "Atlas 服务地址" "本机试用或已部署的 Atlas 服务根地址"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 42u "本机试用使用默认地址。服务器部署后可在开始菜单的“Atlas 服务设置”修改。$\r$\n不要填写 /api、网页路径、密码或令牌。"
  Pop $0
  ${NSD_CreateText} 0 48u 100% 14u "$Origin"
  Pop $OriginInput
  ${NSD_CreateCheckbox} 0 76u 100% 20u "登录 Windows 时启动 Atlas 本地助手"
  Pop $AutostartInput
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AtlasWps"
  ${If} $0 == '"$INSTDIR\AtlasWps.exe"'
    ${NSD_Check} $AutostartInput
  ${EndIf}
  nsDialogs::Show
FunctionEnd
Function OriginLeave
  ${NSD_GetText} $OriginInput $Origin
  ${NSD_GetState} $AutostartInput $Autostart
  # Reject command-line quoting/control characters before passing to the strict URI validator.
  StrCpy $0 0
  loop:
    StrCpy $1 $Origin 1 $0
    ${If} $1 == ""
      Goto complete
    ${EndIf}
    ${If} $1 == '"'
    ${OrIf} $1 == "$\r"
    ${OrIf} $1 == "$\n"
      MessageBox MB_ICONSTOP "服务地址包含无效字符。"
      Abort
    ${EndIf}
    IntOp $0 $0 + 1
    Goto loop
  complete:
    InitPluginsDir
    File /oname=$PLUGINSDIR\AtlasValidator.exe "${PAYLOAD}\AtlasWps.exe"
    ExecWait '"$PLUGINSDIR\AtlasValidator.exe" --validate "$Origin"' $0
    ${If} $0 != 0
      Abort
    ${EndIf}
FunctionEnd
Function StartAtlas
  Exec '"$INSTDIR\AtlasWps.exe"'
FunctionEnd

Section "Atlas WPS 数据助手"
  IfFileExists "$INSTDIR\AtlasWps.exe" 0 stopped
    ExecWait '"$INSTDIR\AtlasWps.exe" --stop' $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "无法停止旧 Atlas 助手，请从系统托盘退出后重试。"
      Abort
    ${EndIf}
  stopped:
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  # Retire obsolete generated icons; new shortcuts use a fresh badge path.
  Delete "$INSTDIR\atlas.ico"
  Delete "$INSTDIR\atlas-desktop.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ExecWait '"$INSTDIR\AtlasWps.exe" --configure "$Origin"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Atlas 地址无效，未登记加载项。请重新运行安装包修正地址。"
    Abort
  ${EndIf}
  ExecWait '"$INSTDIR\AtlasWps.exe" --register' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "WPS 配置登记失败，请退出 WPS 后重试。"
    Abort
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\Atlas WPS 数据助手"
  CreateShortcut "$SMPROGRAMS\Atlas WPS 数据助手\Atlas WPS 数据助手.lnk" "$INSTDIR\AtlasWps.exe" "" "$INSTDIR\atlas-badge.ico" 0
  CreateShortcut "$SMPROGRAMS\Atlas WPS 数据助手\Atlas 服务设置.lnk" "$INSTDIR\AtlasWps.exe" "--settings" "$INSTDIR\atlas-badge.ico" 0
  CreateShortcut "$SMPROGRAMS\Atlas WPS 数据助手\卸载.lnk" "$INSTDIR\Uninstall.exe"
  ${If} $Autostart == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AtlasWps" '"$INSTDIR\AtlasWps.exe"'
  ${Else}
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AtlasWps"
    ${If} $0 == '"$INSTDIR\AtlasWps.exe"'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AtlasWps"
    ${EndIf}
  ${EndIf}
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps" "DisplayName" "Atlas WPS 数据助手"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps" "DisplayVersion" "0.4.1"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps" "DisplayIcon" "$INSTDIR\AtlasWps.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps" "NoRepair" 1
SectionEnd
Function un.onInit
  SetShellVarContext current
  ${If} $INSTDIR != "$LOCALAPPDATA\Programs\AtlasWps"
    MessageBox MB_ICONSTOP "卸载目录不正确，已停止操作。请从 Windows 应用列表卸载。"
    Abort
  ${EndIf}
  MessageBox MB_OKCANCEL "请先保存文件并退出 WPS。卸载不删除工作簿，不取消服务器查询，不移除其他加载项。" IDOK +2
    Abort
FunctionEnd
Section "Uninstall"
  ExecWait '"$INSTDIR\AtlasWps.exe" --stop' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Atlas 助手尚未退出，卸载已停止。"
    Abort
  ${EndIf}
  ExecWait '"$INSTDIR\AtlasWps.exe" --unregister' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "WPS 配置处理失败，未删除插件文件。请退出 WPS 后重试。"
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AtlasWps"
  ${If} $0 == '"$INSTDIR\AtlasWps.exe"'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AtlasWps"
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasWps"
  Delete "$SMPROGRAMS\Atlas WPS 数据助手\Atlas WPS 数据助手.lnk"
  Delete "$SMPROGRAMS\Atlas WPS 数据助手\Atlas 服务设置.lnk"
  Delete "$SMPROGRAMS\Atlas WPS 数据助手\卸载.lnk"
  RMDir "$SMPROGRAMS\Atlas WPS 数据助手"
  # Generated explicit file manifest, no recursive directory deletion.
  !include "${PAYLOAD}\..\uninstall-files.nsh"
  Delete "$INSTDIR\atlas-origin.txt"
  Delete "$INSTDIR\session.dat"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
