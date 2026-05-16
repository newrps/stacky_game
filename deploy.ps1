# Wrapper - delegate to C:\git\deploy-all.ps1 for this project only.
# Usage:  .\deploy.ps1            # commit + push + NAS deploy
#         .\deploy.ps1 -Force     # rebuild even with no changes
#         .\deploy.ps1 -DryRun    # plan only
#         .\deploy.ps1 -Message "fix X"
$me = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectName = Split-Path -Leaf $me
& "C:\git\deploy-all.ps1" $projectName @args
