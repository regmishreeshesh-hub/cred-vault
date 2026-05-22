package vault

type Credential struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	URL          string `json:"url"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	Port         int    `json:"port"`
	KeyFile      string `json:"key_file"`
	SecretKey    string `json:"secret_key"`
	Notes        string `json:"notes"`
	Service      string `json:"service"`
	InstanceName string `json:"instance_name"`
	PublicIP     string `json:"public_ip"`
	Remarks      string `json:"remarks"`
	AWSAccount   string `json:"aws_account"`
	AWSRegion    string `json:"aws_region"`
	OSService    string `json:"os_service"`
	SSHCol       string `json:"ssh_col"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type VaultData struct {
	Credentials []Credential `json:"credentials"`
}

type VaultFile struct {
	Salt       []byte `json:"salt"`
	Nonce      []byte `json:"nonce"`
	Ciphertext []byte `json:"ciphertext"`
}
