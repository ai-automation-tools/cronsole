<#
.SYNOPSIS
    Let only you, Administrators and SYSTEM write to the Cronsole folder.

.DESCRIPTION
    The elevated agent, and the scripts the elevated \Cronsole-Stack\ tasks run, live in
    this clone. A folder outside your profile usually inherits the drive's permissions,
    and on many drives that is "Authenticated Users: Modify" or wider. Any other account
    on the machine could then replace agent\publish\Cronsole.Agent.dll or
    scripts\cronsole.ps1 and be an administrator within five minutes.

    This replaces the folder's permissions with three entries, inherited by everything
    inside: Administrators and SYSTEM full control, and the named user full control.
    Other accounts get nothing, which also keeps them out of backend\.env.

    WHAT IT DOES NOT DO: stop a program running as YOU. Your own un-elevated processes,
    Cronsole-native jobs included, can still edit these files. See docs/TRUST.md.

    Undo:  icacls <folder> /reset

.PARAMETER Path
    Folder to lock. Default: the repo this script sits in.

.PARAMETER User
    The account that keeps write access. Default: the current user.

.PARAMETER Check
    Change nothing. List who else can write, and exit 1 if anyone can.
#>
[CmdletBinding()]
param(
    [string]$Path,
    [string]$User = "$env:USERDOMAIN\$env:USERNAME",
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
if (-not $Path) { $Path = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }

$Sid       = [System.Security.Principal.SecurityIdentifier]
$UserSid   = (New-Object System.Security.Principal.NTAccount($User)).Translate($Sid).Value
$Admins    = 'S-1-5-32-544'
$System    = 'S-1-5-18'
# TrustedInstaller: present on some system-created folders, and no account can sign in as it.
$Installer = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$Trusted   = @($UserSid, $Admins, $System, $Installer)

$Rights  = [System.Security.AccessControl.FileSystemRights]
$Writing = $Rights::Write -bor $Rights::Delete -bor $Rights::DeleteSubdirectoriesAndFiles -bor
           $Rights::ChangePermissions -bor $Rights::TakeOwnership
# The same grants written as generic rights, which is how inherited entries often arrive.
$GenericWriting = 0x40000000 -bor 0x10000000

# Who, other than the trusted four, can change this file or folder.
function Get-OtherWriters([string]$Target) {
    $found = @()
    foreach ($ace in (Get-Acl -LiteralPath $Target).Access) {
        if ($ace.AccessControlType -ne 'Allow') { continue }
        # An inherit-only entry applies to children, not to this object.
        if ($ace.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
        $bits = [int]$ace.FileSystemRights
        if (-not (($bits -band [int]$Writing) -or ($bits -band $GenericWriting))) { continue }
        try { $aceSid = $ace.IdentityReference.Translate($Sid).Value } catch { $aceSid = "$($ace.IdentityReference)" }
        if ($Trusted -notcontains $aceSid) { $found += "$($ace.IdentityReference)" }
    }
    $found | Sort-Object -Unique
}

if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "Folder not found: $Path" }

if (-not $Check) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)   # stop inheriting from the drive; keep nothing
    foreach ($s in @($Admins, $System, $UserSid)) {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
            (New-Object $Sid($s)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    }
    try {
        # Not Set-Acl: on PowerShell 7 it also writes the audit list, which needs a privilege
        # an ordinary administrator prompt does not hold.
        $dir = New-Object System.IO.DirectoryInfo($Path)
        if ($PSVersionTable.PSEdition -eq 'Core') { [System.IO.FileSystemAclExtensions]::SetAccessControl($dir, $acl) }
        else { $dir.SetAccessControl($acl) }
    } catch {
        throw "Could not change permissions on $Path. Run this from an Administrator PowerShell. ($($_.Exception.Message))"
    }
    Write-Host "Locked $Path : only $User, Administrators and SYSTEM can write."
}

# Checked after a change too. The folder is not the whole answer: a file inside can carry
# its own entry, so the two things an elevated task runs are read directly as well.
$targets = @($Path) + @('agent\publish\Cronsole.Agent.dll', 'scripts\cronsole.ps1' |
    ForEach-Object { Join-Path $Path $_ } | Where-Object { Test-Path -LiteralPath $_ })
$open = $false
foreach ($t in $targets) {
    $others = @(Get-OtherWriters $t)
    if ($others.Count -gt 0) {
        $open = $true
        Write-Host ("WRITABLE BY OTHERS: {0}  ({1})" -f $t, ($others -join ', '))
    }
}
if ($open) {
    Write-Host 'Fix:  scripts\startup-task\Protect-RepoFolder.ps1   (then, for a file still listed:  icacls <file> /reset)'
    exit 1
}
if ($Check) { Write-Host "OK: only $User, Administrators and SYSTEM can write to $Path." }
exit 0
