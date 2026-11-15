package api

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func buildBackupZip(t *testing.T, files [][2][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range files {
		w, err := zw.Create(string(f[0]))
		if err != nil {
			t.Fatalf("创建 zip 条目失败: %v", err)
		}
		if _, err := w.Write(f[1]); err != nil {
			t.Fatalf("写入 zip 条目失败: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("关闭 zip 失败: %v", err)
	}
	return buf.Bytes()
}

func manifestJSON(t *testing.T, events, gifts int, checksums map[string]string) []byte {
	t.Helper()
	m := map[string]any{"format": backupFormat, "version": backupVersion, "events": events, "gifts": gifts}
	if checksums != nil {
		m["checksums"] = checksums
	}
	payload, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("序列化 manifest 失败: %v", err)
	}
	return payload
}

func sampleBackupData(t *testing.T) (events, gifts []byte) {
	t.Helper()
	raw := append([]byte("GBv2"), bytes.Repeat([]byte{1}, 16)...)
	raw = append(raw, bytes.Repeat([]byte{2}, 48)...)
	cipher := base64.StdEncoding.EncodeToString(raw)
	events = []byte(`{"e1":{"id":"e1","name":"完整性测试","passwordHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","startDateTime":"2026-11-04T10:00","endDateTime":"2026-11-05T22:00","theme":"theme-festive","category":"red","template":"婚宴","coverStyle":"shuangxi","totalAmount":0}}`)
	gifts = []byte(`{"g1":{"id":"g1","eventId":"e1","encryptedContent":"` + cipher + `"}}`)
	return
}

func TestParseBackupAcceptsIntactPackage(t *testing.T) {
	events, gifts := sampleBackupData(t)
	sums := map[string]string{
		"data/events.json":   contentHash(events),
		"data/gifts_e1.json": contentHash(gifts),
	}
	data := buildBackupZip(t, [][2][]byte{
		{[]byte("manifest.json"), manifestJSON(t, 1, 1, sums)},
		{[]byte("data/events.json"), events},
		{[]byte("data/gifts_e1.json"), gifts},
	})
	if _, err := (&Server{}).parseBackupZip(data); err != nil {
		t.Fatalf("完整备份包应通过: %v", err)
	}
}

func TestParseBackupRejectsTamperedContent(t *testing.T) {
	events, gifts := sampleBackupData(t)
	sums := map[string]string{
		"data/events.json":   contentHash(events),
		"data/gifts_e1.json": contentHash(gifts),
	}
	tamperedEvents := []byte(`{"e1":{"id":"e1","name":"被改过","passwordHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","startDateTime":"2026-11-04T10:00","endDateTime":"2026-11-05T22:00","theme":"theme-festive","category":"red","template":"婚宴","coverStyle":"shuangxi","totalAmount":0}}`)
	data := buildBackupZip(t, [][2][]byte{
		{[]byte("manifest.json"), manifestJSON(t, 1, 1, sums)},
		{[]byte("data/events.json"), tamperedEvents},
		{[]byte("data/gifts_e1.json"), gifts},
	})
	if _, err := (&Server{}).parseBackupZip(data); err == nil {
		t.Fatal("内容被改动的备份包应被拒绝")
	}
}

func TestParseBackupRejectsIncompletePackage(t *testing.T) {
	events, _ := sampleBackupData(t)
	// manifest 声明 1 本 1 条，但包内缺少礼金文件（模拟截断/丢文件）。
	data := buildBackupZip(t, [][2][]byte{
		{[]byte("manifest.json"), manifestJSON(t, 1, 1, nil)},
		{[]byte("data/events.json"), events},
	})
	if _, err := (&Server{}).parseBackupZip(data); err == nil {
		t.Fatal("缺少礼金数据的备份包应被拒绝")
	}
}

func TestParseBackupAcceptsLegacyWithoutChecksums(t *testing.T) {
	events, gifts := sampleBackupData(t)
	data := buildBackupZip(t, [][2][]byte{
		{[]byte("manifest.json"), manifestJSON(t, 1, 1, nil)},
		{[]byte("data/events.json"), events},
		{[]byte("data/gifts_e1.json"), gifts},
	})
	if _, err := (&Server{}).parseBackupZip(data); err != nil {
		t.Fatalf("无校验和的旧备份包应兼容: %v", err)
	}
}
