param([int]$Port = 8080)

Write-Host "Abrindo copia local em http://localhost:$Port"
python -m http.server $Port
