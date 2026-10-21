; Zamyka grę i stary deinstalator, zanim instalator nadpisze pliki.
; Sprawdzenie electron-buildera patrzy na ścieżkę procesu. Gdy Windows jej nie poda,
; gra zostaje otwarta i zapis exe kończy się oknem „Błąd otwarcia pliku do zapisu”.

!macro customCheckAppRunning
  StrCpy $R7 0
  fc27_close_loop:
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Get-Process -Name 'FC27PoorEdition','Uninstall FC27PoorEdition' -ErrorAction SilentlyContinue | Stop-Process -Force"`
    Pop $0
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM FC27PoorEdition.exe`
    Pop $0
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM $\"Uninstall FC27PoorEdition.exe$\"`
    Pop $0
    Sleep 700
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "if (Get-Process -Name 'FC27PoorEdition','Uninstall FC27PoorEdition' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
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

    ; Działający plik da się przenieść, ale nie nadpisać. Stary deinstalator schodzi z drogi.
    ${if} ${FileExists} "$INSTDIR\Uninstall FC27PoorEdition.exe"
      ClearErrors
      Rename "$INSTDIR\Uninstall FC27PoorEdition.exe" "$INSTDIR\Uninstall FC27PoorEdition.exe.old"
    ${endif}
!macroend

!macro customInstall
  Delete "$INSTDIR\Uninstall FC27PoorEdition.exe.old"
!macroend
