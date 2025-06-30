# LocalChater 自定义安装程序脚本

# 设置安装程序外观
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT

# 自定义安装程序文本
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 LocalChater"
!define MUI_WELCOMEPAGE_TEXT "LocalChater 是一款功能强大的局域网聊天软件，支持文件传输和实时通讯。$\r$\n$\r$\n本安装向导将引导您完成 LocalChater 的安装过程。$\r$\n$\r$\n点击 [下一步] 继续。"

# 许可协议页面
!define MUI_LICENSEPAGE_TEXT_TOP "请仔细阅读以下许可协议。如果您接受协议的所有条款，请点击 [我同意] 继续安装。"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "如果您选择 [我同意]，您必须接受协议才能安装 LocalChater。点击 [取消] 退出安装程序。"
!define MUI_LICENSEPAGE_BUTTON "我同意(&A)"

# 安装目录页面
!define MUI_DIRECTORYPAGE_TEXT_TOP "安装程序将在下列文件夹中安装 LocalChater。要安装到不同文件夹，点击 [浏览] 并选择其他文件夹。点击 [下一步] 继续。"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "目标文件夹"

# 安装进度页面
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "安装完成"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "LocalChater 已成功安装到您的计算机。"
!define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "安装已中止"
!define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "安装程序未能完成安装。"

# 完成页面
!define MUI_FINISHPAGE_TITLE "LocalChater 安装完成"
!define MUI_FINISHPAGE_TEXT "LocalChater 已成功安装到您的计算机上。$\r$\n$\r$\n点击 [完成] 关闭此安装向导。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\LocalChater.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 LocalChater"
!define MUI_FINISHPAGE_LINK "访问 LocalChater 官方网站"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/localchater/localchater"

# 卸载确认
!define MUI_UNCONFIRMPAGE_TEXT_TOP "安装程序将从下列文件夹中卸载 LocalChater。点击 [卸载] 开始卸载过程。"

# 设置安装程序属性
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "LocalChater"
VIAddVersionKey "ProductVersion" "1.0.0"
VIAddVersionKey "CompanyName" "LocalChater Team"
VIAddVersionKey "FileDescription" "LocalChater 局域网聊天软件"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "LegalCopyright" "Copyright © 2024 LocalChater Team"
VIAddVersionKey "OriginalFilename" "LocalChater-Setup.exe"

# 自定义函数
Function .onInit
    # 检查是否已经安装
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LocalChater" "UninstallString"
    StrCmp $R0 "" done
    
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "LocalChater 已经安装。$\n$\n点击 [确定] 移除之前的版本或点击 [取消] 取消此次安装。" IDOK uninst
    Abort
    
    uninst:
        ClearErrors
        ExecWait '$R0 _?=$INSTDIR'
        
        IfErrors no_remove_uninstaller done
        no_remove_uninstaller:
    
    done:
FunctionEnd

# 安装后操作
Function .onInstSuccess
    # 创建防火墙规则提示
    MessageBox MB_YESNO "是否允许 LocalChater 通过 Windows 防火墙？$\n$\n这将有助于程序正常工作。" IDNO skip_firewall
    
    # 这里可以添加防火墙规则的代码
    
    skip_firewall:
FunctionEnd