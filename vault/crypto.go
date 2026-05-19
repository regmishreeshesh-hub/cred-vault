package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"

	"golang.org/x/crypto/pbkdf2"
)

const (
	KeySize    = 32
	Iterations = 600000
)

func deriveKey(masterPass string, salt []byte) []byte {
	return pbkdf2.Key([]byte(masterPass), salt, Iterations, KeySize, sha256.New)
}

func EncryptVault(data *VaultData, masterPass string) (*VaultFile, error) {
	salt := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}
	key := deriveKey(masterPass, salt)
	plaintext, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	ciphertext := aesGCM.Seal(nil, nonce, plaintext, nil)
	return &VaultFile{Salt: salt, Nonce: nonce, Ciphertext: ciphertext}, nil
}

func DecryptVault(vf *VaultFile, masterPass string) (*VaultData, error) {
	key := deriveKey(masterPass, vf.Salt)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plaintext, err := aesGCM.Open(nil, vf.Nonce, vf.Ciphertext, nil)
	if err != nil {
		return nil, errors.New("wrong master password or corrupted vault")
	}
	var data VaultData
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return nil, err
	}
	return &data, nil
}
