; Zamyka grę i stary deinstalator, zanim instalator nadpisze pliki.
; Domyślne sprawdzenie electron-buildera patrzy na ścieżkę procesu i nie widzi
; FC27PoorEdition.exe, gdy Windows nie poda Path. Wtedy zapis Uninstall *.exe
; kończy się oknem „Błąd otwarcia pliku do zapisu”.

!macro customCheckAppRunning
  StrCpy $R7 0
  fc27_close_loop:
    nsExec::Exec `"$CmdPath" /C taskkill /F /T /IM "FC27PoorEdition.exe"`
    Pop $0
    nsExec::Exec `"$CmdPath" /C taskkill /F /T /IM "Uninstall FC27PoorEdition.exe"`
    Pop $0
    Sleep 600
    nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq FC27PoorEdition.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /I /C:"FC27PoorEdition.exe"`
    Pop $0
    ${if} $0 == 0
      IntOp $R7 $R7 + 1
      ${if} $R7 < 6
        Sleep 800
        Goto fc27_close_loop
      ${endif}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Zamknij FC 27 Poor Edition i kliknij Ponów. Gra jest otwarta, więc instalator nie może zapisać plików." /SD IDCANCEL IDRETRY fc27_close_loop
      Quit
    ${endif}

    nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq Uninstall FC27PoorEdition.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /I /C:"Uninstall FC27PoorEdition.exe"`
    Pop $0
    ${if} $0 == 0
      Sleep 800
      nsExec::Exec `"$CmdPath" /C taskkill /F /T /IM "Uninstall FC27PoorEdition.exe"`
      Pop $0
    ${endif}

    ; Działający plik da się przenieść, ale nie nadpisać. Stary deinstalator schodzi z drogi.
    ${if} ${FileExists} "$INSTDIR\Uninstall FC27PoorEdition.exe"
      ClearErrors
      Rename "$INSTDIR\Uninstall FC27PoorEdition.exe" "$INSTDIR\Uninstall FC27PoorEdition.exe.old"
    ${endif}
!macroend

!macro customInstall
  Delete "$INSTDIR\Uninstall FC27PoorEdition.exe.old"
!macroend
