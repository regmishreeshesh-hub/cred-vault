# Credential Vault

A small local credential vault web app written in Go.

## Prerequisites

- Go 1.25 or newer

## Build From Source

Download dependencies:

```powershell
go mod download
```

Build for your current platform:

```powershell
go build -o cred-vault .
```

On Windows, build a Windows executable:

```powershell
go build -o cred-vault.exe .
```

From Windows PowerShell, build a Linux AMD64 binary:

```powershell
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go build -o cred-vault-linux .
Remove-Item Env:GOOS
Remove-Item Env:GOARCH
```

Run the app:

```powershell
.\cred-vault.exe
```

Then open the URL printed in the terminal. By default, the app listens on `127.0.0.1:9090`.

## Notes

Generated binaries are intentionally ignored by Git. Commit the source code and rebuild binaries locally when needed.
