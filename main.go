package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"embed"
	"encoding/pem"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

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
	mux.HandleFunc("/api/lookup", h.CORSMiddleware(h.Lookup))
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

	var url string
	var listener net.Listener

	certFile, keyFile := getTLSPaths()
	if cert, err := tls.LoadX509KeyPair(certFile, keyFile); err == nil {
		var listenErr error
		listener, listenErr = tls.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port), &tls.Config{
			Certificates: []tls.Certificate{cert},
		})
		if listenErr != nil {
			log.Println("HTTPS failed, falling back to HTTP:", listenErr)
			listener, listenErr = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
			if listenErr != nil {
				log.Fatal(listenErr)
			}
			url = fmt.Sprintf("http://127.0.0.1:%d", listener.Addr().(*net.TCPAddr).Port)
		} else {
			url = fmt.Sprintf("https://127.0.0.1:%d", listener.Addr().(*net.TCPAddr).Port)
		}
	} else {
		var listenErr error
		listener, listenErr = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
		if listenErr != nil {
			log.Fatal(listenErr)
		}
		url = fmt.Sprintf("http://127.0.0.1:%d", listener.Addr().(*net.TCPAddr).Port)
	}

	fmt.Printf("Credential Vault is running at %s\n", url)
	fmt.Println("Close this window or press Ctrl+C to stop the server.")
	openBrowser(url)

	log.Fatal(http.Serve(listener, mux))
}

func getTLSPaths() (string, string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}
	dir := filepath.Join(home, ".cred-vault")
	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")
	if _, err := os.Stat(certPath); os.IsNotExist(err) {
		generateSelfSignedCert(certPath, keyPath)
	}
	return certPath, keyPath
}

func generateSelfSignedCert(certPath, keyPath string) {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".cred-vault")
	os.MkdirAll(dir, 0700)

	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization: []string{"cred-vault"},
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(time.Hour * 24 * 365 * 10),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost", "127.0.0.1"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &priv.PublicKey, priv)
	if err != nil {
		return
	}

	certOut, err := os.Create(certPath)
	if err != nil {
		return
	}
	pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	certOut.Close()

	keyOut, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return
	}
	pem.Encode(keyOut, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})
	keyOut.Close()
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
