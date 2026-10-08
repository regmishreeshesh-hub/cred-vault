package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
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
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
	Locked   bool   `json:"locked"`
	FirstRun bool   `json:"first_run"`
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

	if req.KeyFile != "" {
		keyFile := expandPath(req.KeyFile)
		if _, err := os.Stat(keyFile); os.IsNotExist(err) {
			json.NewEncoder(w).Encode(statusResponse{Status: "error", Message: "key file not found: " + keyFile})
			return
		}
		req.KeyFile = keyFile
	}

	clipboardMsg := ""
	if req.Password != "" {
		if err := copyToClipboard(req.Password); err != nil {
			clipboardMsg = " (clipboard unavailable: " + err.Error() + ")"
		}
	}

	sshArgs := buildSSHArgs(req.Host, req.Port, req.Username, req.KeyFile)
	cmd, err := openTerminal(sshArgs)
	if err != nil {
		json.NewEncoder(w).Encode(statusResponse{Status: "error", Message: err.Error()})
		return
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
	json.NewEncoder(w).Encode(statusResponse{Status: "ok", Message: msg + clipboardMsg})
}

func buildSSHArgs(host string, port int, username string, keyFile string) []string {
	args := []string{"-o", "StrictHostKeyChecking=no"}
	if keyFile != "" {
		args = append(args, "-i", keyFile)
	}
	args = append(args, "-p", fmt.Sprintf("%d", port), fmt.Sprintf("%s@%s", username, host))
	return args
}

func copyToClipboard(text string) error {
	switch runtime.GOOS {
	case "darwin":
		cmd := exec.Command("pbcopy")
		cmd.Stdin = strings.NewReader(text)
		return cmd.Run()
	case "windows":
		cmd := exec.Command("powershell", "-Command", "Set-Clipboard", "-Value", text)
		return cmd.Run()
	default:
		// Try Wayland clipboard utility first
		if _, err := exec.LookPath("wl-copy"); err == nil {
			cmd := exec.Command("wl-copy")
			cmd.Stdin = strings.NewReader(text)
			if err := cmd.Run(); err == nil {
				return nil
			}
		}
		// Fall back to X11 utilities
		if _, err := exec.LookPath("xclip"); err == nil {
			cmd := exec.Command("xclip", "-selection", "clipboard")
			cmd.Stdin = strings.NewReader(text)
			if err := cmd.Run(); err == nil {
				return nil
			}
		}
		if _, err := exec.LookPath("xsel"); err == nil {
			cmd := exec.Command("xsel", "--clipboard", "--input")
			cmd.Stdin = strings.NewReader(text)
			if err := cmd.Run(); err == nil {
				return nil
			}
		}
		return fmt.Errorf("no clipboard utility available")
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

func expandPath(path string) string {
	if path == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			return home
		}
	} else if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			path = filepath.Join(home, path[2:])
		}
	}
	return path
}

func buildSSHCmd(sshArgs []string) string {
	var sb strings.Builder
	sb.WriteString("ssh")
	for _, arg := range sshArgs {
		sb.WriteString(" ")
		sb.WriteString(shellQuote(arg))
	}
	sb.WriteString("; exec bash")
	return sb.String()
}

func openTerminal(sshArgs []string) (*exec.Cmd, error) {
	sshCmd := buildSSHCmd(sshArgs)
	switch runtime.GOOS {
	case "windows":
		allArgs := append([]string{"/k", "ssh"}, sshArgs...)
		return exec.Command("cmd", allArgs...), nil
	case "darwin":
		escaped := strings.ReplaceAll(sshCmd, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)
		script := fmt.Sprintf(`tell app "Terminal" to do script "%s"`, escaped)
		return exec.Command("osascript", "-e", script), nil
	default:
		terminals := []string{"gnome-terminal", "x-terminal-emulator", "xterm", "mate-terminal", "xfce4-terminal"}
		for _, term := range terminals {
			if _, err := exec.LookPath(term); err != nil {
				continue
			}
			args := []string{"--", "bash", "-c", sshCmd}
			return exec.Command(term, args...), nil
		}
		return nil, fmt.Errorf("no terminal emulator found (tried: %s)", strings.Join(terminals, ", "))
	}
}

func (h *Handler) Lookup(w http.ResponseWriter, r *http.Request) {
	domain := normalizeLookupDomain(r.URL.Query().Get("domain"))
	if domain == "" {
		http.Error(w, "domain required", http.StatusBadRequest)
		return
	}
	creds := h.Vault.List()
	var matches []vault.Credential
	for _, c := range creds {
		if c.Type != "web" && c.Type != "" {
			continue
		}
		credDomain := normalizeLookupDomain(c.URL)
		if credDomain == "" {
			continue
		}
		if credDomain == domain || strings.HasSuffix(credDomain, "."+domain) || strings.HasSuffix(domain, "."+credDomain) {
			matches = append(matches, c)
		}
	}
	if matches == nil {
		matches = []vault.Credential{}
	}
	json.NewEncoder(w).Encode(matches)
}

func normalizeLookupDomain(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "://") {
		if u, err := url.Parse(raw); err == nil && u.Hostname() != "" {
			raw = u.Hostname()
		}
	} else if strings.Contains(raw, "/") || strings.Contains(raw, ":") {
		if u, err := url.Parse("//" + raw); err == nil && u.Hostname() != "" {
			raw = u.Hostname()
		}
	}
	raw = strings.TrimSuffix(raw, ".")
	raw = strings.TrimPrefix(raw, "www.")
	return raw
}

func (h *Handler) Middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

// CORSMiddleware allows cross-origin GET requests. It is only applied to
// /api/lookup, since that is the sole endpoint the bookmarklet calls from
// arbitrary third-party pages; every other endpoint is same-origin only.
func (h *Handler) CORSMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
			w.WriteHeader(http.StatusOK)
			return
		}
		h.Middleware(next)(w, r)
	}
}
