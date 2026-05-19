package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"

	"cred-vault/handlers"
	"cred-vault/vault"
)

//go:embed static/*
var staticFiles embed.FS

func main() {
	port := flag.Int("port", 9090, "Port to listen on")
	vaultPath := flag.String("vault", "vault.json", "Path to the vault file")
	flag.Parse()

	v := vault.NewVault(*vaultPath)
	h := handlers.NewHandler(v)

	mux := http.NewServeMux()

	mux.HandleFunc("/api/status", h.Middleware(h.Status))
	mux.HandleFunc("/api/unlock", h.Middleware(h.Unlock))
	mux.HandleFunc("/api/lock", h.Middleware(h.Lock))
	mux.HandleFunc("/api/connect", h.Middleware(h.Connect))
	mux.HandleFunc("/api/credentials", h.Middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			h.List(w, r)
		case "POST":
			h.Add(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	mux.HandleFunc("/api/credentials/", h.Middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "PUT":
			h.Update(w, r)
		case "DELETE":
			h.Delete(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	sub, _ := fs.Sub(staticFiles, "static")
	mux.Handle("/", http.FileServer(http.FS(sub)))

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatal(err)
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://127.0.0.1:%d", actualPort)

	fmt.Printf("Credential Vault is running at %s\n", url)
	fmt.Println("Close this window or press Ctrl+C to stop the server.")
	openBrowser(url)

	log.Fatal(http.Serve(listener, mux))
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}
