package vault

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Vault struct {
	mu       sync.Mutex
	FilePath string
	Data     *VaultData
	locked   bool
}

func NewVault(path string) *Vault {
	return &Vault{
		FilePath: path,
		Data:     &VaultData{Credentials: []Credential{}},
		locked:   true,
	}
}

func (v *Vault) IsLocked() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.locked
}

func (v *Vault) Unlock(masterPass string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, err := os.Stat(v.FilePath); os.IsNotExist(err) {
		v.Data = &VaultData{Credentials: []Credential{}}
		v.locked = false
		return nil
	}
	raw, err := os.ReadFile(v.FilePath)
	if err != nil {
		return err
	}
	var vf VaultFile
	if err := json.Unmarshal(raw, &vf); err != nil {
		return err
	}
	data, err := DecryptVault(&vf, masterPass)
	if err != nil {
		return err
	}
	v.Data = data
	v.locked = false
	return nil
}

func (v *Vault) Lock() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.locked = true
	v.Data = &VaultData{Credentials: []Credential{}}
}

func (v *Vault) Save(masterPass string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	os.MkdirAll(filepath.Dir(v.FilePath), 0700)
	vf, err := EncryptVault(v.Data, masterPass)
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(vf, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(v.FilePath, raw, 0600)
}

func (v *Vault) List() []Credential {
	v.mu.Lock()
	defer v.mu.Unlock()
	out := make([]Credential, len(v.Data.Credentials))
	copy(out, v.Data.Credentials)
	return out
}

func (v *Vault) Add(c Credential) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.Data.Credentials = append(v.Data.Credentials, c)
}

func (v *Vault) Update(id string, c Credential) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	for i, cred := range v.Data.Credentials {
		if cred.ID == id {
			c.ID = id
			v.Data.Credentials[i] = c
			return true
		}
	}
	return false
}

func (v *Vault) Delete(id string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	for i, cred := range v.Data.Credentials {
		if cred.ID == id {
			v.Data.Credentials = append(v.Data.Credentials[:i], v.Data.Credentials[i+1:]...)
			return true
		}
	}
	return false
}

func VaultExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
