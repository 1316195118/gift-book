package api

import (
	"archive/zip"
	"bytes"
	"io"
	"testing"

	"giftbook/internal/backup"
	"giftbook/internal/store"
)

// 备份还原演练：走真实的三段链路（backup.Build 导出 → parseBackupZip
// 校验 → applyBackup 还原），在全新数据目录里还原后逐字节比对，
// 确保「备份能不能救回来」这件事每次 CI 都被验证。
func TestBackupRestoreDrill(t *testing.T) {
	src := newEnv(t)

	// 源账簿：1 本账簿 + 3 笔礼金（含不同密文，防全零误判）。
	if err := src.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		events["evt_drill"] = store.Record{"id": "evt_drill", "name": "演练账簿", "startDate": "2026-11-19", "endDate": "2026-11-20"}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	ciphers := []string{validCipher(1), validCipher(7), validCipher(23)}
	if err := src.store.WithGifts("evt_drill", func(gifts map[string]store.Record) (bool, error) {
		for i, cipher := range ciphers {
			id := "gift_drill_" + string(rune('a'+i))
			gifts[id] = store.Record{"id": id, "eventId": "evt_drill", "encryptedContent": cipher, "createdAt": "2026-11-19 12:00:00"}
		}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}

	// 导出：与线上 GET /api/backup 共用同一实现。
	data, manifest, err := backup.Build(src.store, "drill-build", false, nil)
	if err != nil {
		t.Fatalf("导出备份失败: %v", err)
	}
	if manifest.Events != 1 || manifest.Gifts != 3 {
		t.Fatalf("清单数量不对: %+v", manifest)
	}

	// 还原到全新空目录。
	targetEnv := newEnv(t)
	parsed, err := targetEnv.api.parseBackupZip(data)
	if err != nil {
		t.Fatalf("备份校验失败: %v", err)
	}
	result, err := targetEnv.api.applyBackup(parsed)
	if err != nil {
		t.Fatalf("还原失败: %v", err)
	}
	if result["events"].(int) != 1 || result["gifts"].(int) != 3 {
		t.Fatalf("还原结果与清单不一致: %v", result)
	}

	// 逐字节比对：账簿字段 + 每笔密文与顺序无关地一一对应。
	var event store.Record
	if err := targetEnv.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event = events["evt_drill"]
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
	if event["name"] != "演练账簿" {
		t.Fatalf("账簿字段还原错误: %v", event)
	}
	got := map[string]string{}
	if err := targetEnv.store.WithGifts("evt_drill", func(gifts map[string]store.Record) (bool, error) {
		for id, gift := range gifts {
			got[id], _ = gift["encryptedContent"].(string)
		}
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
	for i, cipher := range ciphers {
		id := "gift_drill_" + string(rune('a'+i))
		if got[id] != cipher {
			t.Fatalf("%s 密文还原不一致：期望 %q，实际 %q", id, cipher, got[id])
		}
	}
}

// 被篡改的备份必须在还原前被拦下，不能把坏数据写进账簿。
// 做法与字节搜索无关：解开 zip、改掉账簿名、重新打包，保证任何平台上
// 校验和都能发现内容被改（原来在压缩流里搜明文，store/deflate 差异会让测试时灵时不灵）。
func TestBackupRestoreRejectsTampered(t *testing.T) {
	src := newEnv(t)
	if err := src.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		events["evt_t"] = store.Record{"id": "evt_t", "name": "原账簿"}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	original, _, err := backup.Build(src.store, "drill", false, nil)
	if err != nil {
		t.Fatal(err)
	}

	// 解开 → 篡改 events.json → 原样文件名重新打包。
	reader, err := zip.NewReader(bytes.NewReader(original), int64(len(original)))
	if err != nil {
		t.Fatal(err)
	}
	var tampered bytes.Buffer
	writer := zip.NewWriter(&tampered)
	for _, entry := range reader.File {
		content, readErr := readZipEntry(entry)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if entry.Name == "data/events.json" {
			content = bytes.ReplaceAll(content, []byte("原账簿"), []byte("假账簿"))
		}
		header := &zip.FileHeader{Name: entry.Name, Method: zip.Store}
		header.SetModTime(entry.Modified)
		out, createErr := writer.CreateHeader(header)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, err := out.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	targetEnv := newEnv(t)
	if _, err := targetEnv.api.parseBackupZip(tampered.Bytes()); err == nil {
		t.Fatal("被篡改的备份应被校验拦截")
	}
}

func readZipEntry(entry *zip.File) ([]byte, error) {
	rc, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}
