# SANJEEVANI failover ladder demo (run from the sanjeevani/ folder)
# Watch http://localhost:9000 while running these one by one.

Write-Host "1) Rain fade on the satellite (predictive failover to towers)..."
Invoke-RestMethod "http://localhost:9101/set?loss=0.4" | Out-Null
Read-Host "   Dashboard: satellite DEGRADED, pods prefer their cell tower. Enter to continue"

Write-Host "2) Satellite fails completely..."
docker stop satellite | Out-Null
Read-Host "   Dashboard: satellite DOWN, all pods on cell towers (Tier 2). Enter to continue"

Write-Host "3) South tower (cell_tower_2) fails -> pod3/pod4 relay via mesh..."
docker stop cell_tower_2 | Out-Null
Read-Host "   Dashboard: pod3/pod4 now Tier 1 (mesh via pod2 -> cell_tower_1). Enter to continue"

Write-Host "4) North tower fails too -> total isolation, ISLAND MODE..."
docker stop cell_tower_1 | Out-Null
Read-Host "   Pods show 'island / no contact'. Submit a request on http://localhost:9201 - it queues. Enter to restore"

Write-Host "5) Satellite returns -> queued events sync automatically..."
docker start satellite | Out-Null
Start-Sleep -Seconds 8
Write-Host "   Dashboard: pods back to Tier 2; queued events arrive tagged 'synced from queue'."

docker start cell_tower_1 cell_tower_2 | Out-Null
Invoke-RestMethod "http://localhost:9101/set?loss=0" | Out-Null
Write-Host "All paths restored. Demo complete."
