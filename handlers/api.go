package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"cred-vault/vault"
)

type Handler struct {
	Vault      *vault.Vault
	MasterPass string
}

type statusResponse struct {
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	Locked    bool   `json:"locked"`
	FirstRun  bool   `json:"first_run"`
}

func NewHandler(v *vault.Vault) *Handler {
	return &Handler{Vault: v}
}

func (h *Handler) SetMasterPass(pass string) {
	h.MasterPass = pass
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(statusResponse{
		Status:   "ok",
		Locked:   h.Vault.IsLocked() || h.MasterPass == "",
		FirstRun: !vault.VaultExists(h.Vault.FilePath) && h.Vault.IsLocked(),
	})
}

func (h *Handler) Unlock(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Vault.Unlock(req.Password); err != nil {
		json.NewEncoder(w).Encode(statusResponse{
			Status:  "error",
			Message: err.Error(),
			Locked:  true,
		})
		return
	}
	h.SetMasterPass(req.Password)
	json.NewEncoder(w).Encode(statusResponse{Status: "ok", Locked: false})
}

func (h *Handler) Lock(w http.ResponseWriter, r *http.Request) {
	h.Vault.Lock()
	h.MasterPass = ""
	json.NewEncoder(w).Encode(statusResponse{Status: "ok", Locked: true})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(h.Vault.List())
}

func (h *Handler) Add(w http.ResponseWriter, r *http.Request) {
	var c vault.Credential
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	id := make([]byte, 16)
	rand.Read(id)
	c.ID = hex.EncodeToString(id)
	now := time.Now().UTC().Format(time.RFC3339)
	c.CreatedAt = now
	c.UpdatedAt = now
	h.Vault.Add(c)
	if err := h.Vault.Save(h.MasterPass); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(c)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/credentials/")
	var c vault.Credential
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	c.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if !h.Vault.Update(id, c) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := h.Vault.Save(h.MasterPass); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(statusResponse{Status: "ok"})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/credentials/")
	if !h.Vault.Delete(id) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := h.Vault.Save(h.MasterPass); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(statusResponse{Status: "ok"})
}

func (h *Handler) Connect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
		KeyFile  string `json:"key_file"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.Host == "" || req.Username == "" {
		json.NewEncoder(w).Encode(statusResponse{Status: "error", Message: "host and username required"})
		return
	}
	if req.Port == 0 {
		req.Port = 22
	}

	identityArg := ""
	if req.KeyFile != "" {
		identityArg = fmt.Sprintf(`-i "%s"`, req.KeyFile)
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no %s -p %d %s@%s", identityArg, req.Port, req.Username, req.Host)
		psScript := fmt.Sprintf(
			`$pass = "%s"; if ($pass) { Set-Clipboard -Value $pass }; Start-Process -WindowStyle Normal -FilePath "cmd" -ArgumentList "/k", "%s"`,
			req.Password, sshCmd)
		cmd = exec.Command("powershell", "-Command", psScript)
	} else {
		sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no %s -p %d %s@%s", identityArg, req.Port, req.Username, req.Host)
		var termCmd string
		if _, err := exec.LookPath("x-terminal-emulator"); err == nil {
			termCmd = fmt.Sprintf("x-terminal-emulator -e bash -c '%s; exec bash'", sshCmd)
		} else if _, err := exec.LookPath("gnome-terminal"); err == nil {
			termCmd = fmt.Sprintf("gnome-terminal -- bash -c '%s; exec bash'", sshCmd)
		} else if _, err := exec.LookPath("osascript"); err == nil {
			termCmd = fmt.Sprintf("osascript -e 'tell app \"Terminal\" to do script \"%s\"'", sshCmd)
		} else {
			json.NewEncoder(w).Encode(statusResponse{Status: "error", Message: "no terminal emulator found"})
			return
		}
		copyCmd := ""
		if req.Password != "" {
			copyCmd = fmt.Sprintf("echo -n '%s' | pbcopy 2>/dev/null || echo -n '%s' | xclip -selection clipboard 2>/dev/null; ", req.Password, req.Password)
		}
		shellCmd := copyCmd + termCmd
		cmd = exec.Command("bash", "-c", shellCmd)
	}

	if err := cmd.Start(); err != nil {
		json.NewEncoder(w).Encode(statusResponse{Status: "error", Message: err.Error()})
		return
	}
	msg := "Terminal opened"
	if req.KeyFile != "" {
		msg = "Connecting with key file"
	} else if req.Password != "" {
		msg = "Password copied — paste it in the terminal"
	}
	json.NewEncoder(w).Encode(statusResponse{Status: "ok", Message: msg})
}

func (h *Handler) Middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if h.Vault.IsLocked() || h.MasterPass == "" {
			if r.URL.Path != "/api/status" && r.URL.Path != "/api/unlock" {
				json.NewEncoder(w).Encode(statusResponse{
					Status: "locked",
					Locked: true,
				})
				return
			}
		}
		next(w, r)
	}
}
