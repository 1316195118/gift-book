package api

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"os"
)

// 加密备份容器 .gbenc：PBKDF2(HMAC-SHA256) + 分块 AES-256-GCM。
// 只用标准库，旧版未加密的 zip 照常识别，互不影响。
//
// 布局：
//
//	"GBENC1"(6) | salt(16) | iterations(4,大端) | noncePrefix(8)
//	[长度(4,大端) | 密文] ... | 结束块(空明文 + final 标记)
//
// 每块 nonce = noncePrefix(8) + 块序号(4,大端)；AAD = 块序号(4) + final 标记(1)。
// 结束块存在且能通过 GCM 校验，才认为文件没有被截断。
const (
	encMagic      = "GBENC1"
	encSaltSize   = 16
	encNonceSize  = 8
	encIterations = 600000
	encChunkSize  = 1 << 20
	encHeaderSize = 6 + encSaltSize + 4 + encNonceSize
)

var errBackupPassword = errors.New("这个备份包已加密，请输入口令")

// pbkdf2Key 用标准库实现 PBKDF2-HMAC-SHA256，避免引入外部依赖。
func pbkdf2Key(password string, salt []byte, iterations, keyLen int) []byte {
	prf := hmac.New(sha256.New, []byte(password))
	hashLen := prf.Size()
	blocks := (keyLen + hashLen - 1) / hashLen
	out := make([]byte, 0, blocks*hashLen)
	var counter [4]byte
	for block := 1; block <= blocks; block++ {
		binary.BigEndian.PutUint32(counter[:], uint32(block))
		prf.Reset()
		prf.Write(salt)
		prf.Write(counter[:])
		u := prf.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iterations; i++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

func encAAD(counter uint32, final bool) []byte {
	aad := make([]byte, 5)
	binary.BigEndian.PutUint32(aad[:4], counter)
	if final {
		aad[4] = 1
	}
	return aad
}

func encNonce(prefix []byte, counter uint32) []byte {
	nonce := make([]byte, 12)
	copy(nonce, prefix)
	binary.BigEndian.PutUint32(nonce[8:], counter)
	return nonce
}

// encryptBackup 把明文 zip 流加密写入 dst。
func encryptBackup(src io.Reader, dst io.Writer, password string) error {
	if password == "" {
		return errors.New("备份口令不能为空")
	}
	salt := make([]byte, encSaltSize)
	prefix := make([]byte, encNonceSize)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return err
	}
	if _, err := io.ReadFull(rand.Reader, prefix); err != nil {
		return err
	}
	header := make([]byte, 0, encHeaderSize)
	header = append(header, []byte(encMagic)...)
	header = append(header, salt...)
	var iterations [4]byte
	binary.BigEndian.PutUint32(iterations[:], encIterations)
	header = append(header, iterations[:]...)
	header = append(header, prefix...)
	if _, err := dst.Write(header); err != nil {
		return err
	}
	block, err := aes.NewCipher(pbkdf2Key(password, salt, encIterations, 32))
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	buf := make([]byte, encChunkSize)
	var counter uint32
	var length [4]byte
	for {
		n, readErr := io.ReadFull(src, buf)
		if n > 0 {
			sealed := gcm.Seal(nil, encNonce(prefix, counter), buf[:n], encAAD(counter, false))
			binary.BigEndian.PutUint32(length[:], uint32(len(sealed)))
			if _, err := dst.Write(length[:]); err != nil {
				return err
			}
			if _, err := dst.Write(sealed); err != nil {
				return err
			}
			counter++
		}
		if readErr == io.EOF || readErr == io.ErrUnexpectedEOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	// 结束块：空明文 + final 标记，序号紧接数据块，防止截断的包被当成完整包。
	sealed := gcm.Seal(nil, encNonce(prefix, counter), nil, encAAD(counter, true))
	binary.BigEndian.PutUint32(length[:], uint32(len(sealed)))
	if _, err := dst.Write(length[:]); err != nil {
		return err
	}
	_, err = dst.Write(sealed)
	return err
}

// decryptBackup 解密到 dst；口令错误或文件截断都会报错。
func decryptBackup(src io.Reader, dst io.Writer, password string) error {
	header := make([]byte, encHeaderSize)
	if _, err := io.ReadFull(src, header); err != nil {
		return errors.New("加密备份包已损坏")
	}
	if string(header[:6]) != encMagic {
		return errors.New("不是加密备份包")
	}
	salt := header[6 : 6+encSaltSize]
	iterations := int(binary.BigEndian.Uint32(header[22:26]))
	if iterations < 10000 || iterations > 2000000 {
		return errors.New("加密备份包的迭代次数无效")
	}
	prefix := header[26 : 26+encNonceSize]
	block, err := aes.NewCipher(pbkdf2Key(password, salt, iterations, 32))
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	var counter uint32
	var length [4]byte
	for {
		if _, err := io.ReadFull(src, length[:]); err != nil {
			return errors.New("加密备份包被截断")
		}
		size := binary.BigEndian.Uint32(length[:])
		if size == 0 || size > encChunkSize+1024 {
			return errors.New("加密备份包格式无效")
		}
		sealed := make([]byte, size)
		if _, err := io.ReadFull(src, sealed); err != nil {
			return errors.New("加密备份包被截断")
		}
		if counter >= 0xfffffffe {
			return errors.New("加密备份包缺少结束标记")
		}
		nonce := encNonce(prefix, counter)
		// 数据块与结束块只有 AAD 的 final 位不同：两种都试着解，
		// 只有被 GCM 认证通过的一种会被接受，攻击者无法伪造。
		plain, dataErr := gcm.Open(nil, nonce, sealed, encAAD(counter, false))
		if dataErr == nil {
			if _, err := dst.Write(plain); err != nil {
				return err
			}
			counter++
			continue
		}
		plain, finalErr := gcm.Open(nil, nonce, sealed, encAAD(counter, true))
		if finalErr != nil || len(plain) != 0 {
			return errors.New("备份口令不正确，或备份包已损坏")
		}
		return nil
	}
}

// looksEncrypted 读取文件头判断是否 .gbenc，不动文件游标。
func looksEncrypted(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	var head [6]byte
	if _, err := io.ReadFull(f, head[:]); err != nil {
		return false
	}
	return string(head[:]) == encMagic
}
