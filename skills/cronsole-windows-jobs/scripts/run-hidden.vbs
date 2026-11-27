' Run a PowerShell script with no console window at all.
'
' Task Scheduler launches pwsh.exe / powershell.exe as a CONSOLE application, so conhost
' paints a window on the interactive desktop *before* PowerShell ever parses
' -WindowStyle Hidden. The flash is unavoidable that way, and on a 15-minute timer it is
' unbearable.
'
' wscript.exe is a windowless host, and Shell.Run(cmd, 0, True) starts the child hidden
' AND waits for it, so the child's exit code still reaches the scheduled task.
'
' Prefers PowerShell 7 and falls back to Windows PowerShell.
'
' Keep this file ASCII with NO BOM -- wscript chokes on a UTF-8 BOM, and the failure mode
' is the task "running" while nothing happens.
'
' Usage: wscript.exe run-hidden.vbs "<full path to .ps1>" [extra args passed to the script]

Option Explicit

Dim fso, shell, exe, cmd, i

If WScript.Arguments.Count < 1 Then WScript.Quit 2

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

exe = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\PowerShell\7\pwsh.exe"
If Not fso.FileExists(exe) Then
    exe = shell.ExpandEnvironmentStrings("%SystemRoot%") & _
          "\System32\WindowsPowerShell\v1.0\powershell.exe"
End If

cmd = """" & exe & """ -NoProfile -ExecutionPolicy Bypass -File """ & _
      WScript.Arguments(0) & """"

' Quote each extra argument, so one containing a space reaches the script whole.
For i = 1 To WScript.Arguments.Count - 1
    cmd = cmd & " """ & Replace(WScript.Arguments(i), """", "\""") & """"
Next

WScript.Quit shell.Run(cmd, 0, True)
