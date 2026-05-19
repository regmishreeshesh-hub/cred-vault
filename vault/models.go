package vault

type Credential struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Port      int    `json:"port"`
	KeyFile   string `json:"key_file"`
	Notes     string `json:"notes"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type VaultData struct {
	Credentials []Credential `json:"credentials"`
}

type VaultFile struct {
	Salt       []byte `json:"salt"`
	Nonce      []byte `json:"nonce"`
	Ciphertext []byte `json:"ciphertext"`
}
