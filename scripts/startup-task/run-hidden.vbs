' run-hidden.vbs - launch a PowerShell script with NO visible window and NO
' console flash.
'
' Why this exists: the self-heal scheduled tasks (\Task-Hub\TaskHubStack,
' \Task-Hub\TaskHubAgent) run classic powershell.exe on a short recurring
' trigger. Even with "-WindowStyle Hidden", powershell.exe is a console app, so
' Windows briefly creates a conhost window on every fire - a PowerShell window
' flashes on screen every few minutes. Passing -WindowStyle Hidden only hides
' the window AFTER it's created, so the flash still happens.
'
' WScript.Shell.Run(cmd, 0, False) creates the process with window style 0
' (SW_HIDE) from the start - the console host is created hidden, never shown -
' and wscript.exe itself is a windowless host, so nothing flashes.
'
' Usage (from a scheduled task's action):
'   Execute:   C:\Windows\System32\wscript.exe
'   Argument:  "<...>\run-hidden.vbs" ["<path-to-script.ps1>" [args...]]
' With no arguments it defaults to running  ..\taskhub.ps1 up  (this .vbs lives
' in scripts\startup-task\, so its grandparent is the repo's scripts\ folder).

Option Explicit

Dim fso, shell, args, scriptPath, psArgs, i, cmd, scriptDir
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set args  = WScript.Arguments

If args.Count >= 1 Then
    scriptPath = args(0)
    psArgs = ""
    For i = 1 To args.Count - 1
        psArgs = psArgs & " " & args(i)
    Next
Else
    ' Default: scripts\taskhub.ps1 up
    scriptDir  = fso.GetParentFolderName(WScript.ScriptFullName)          ' ...\scripts\startup-task
    scriptPath = fso.BuildPath(fso.GetParentFolderName(scriptDir), "taskhub.ps1")  ' ...\scripts\taskhub.ps1
    psArgs = " up"
End If

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """" & psArgs

' 0 = hidden window (created hidden, no flash); False = fire-and-forget.
shell.Run cmd, 0, False
