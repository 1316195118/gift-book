package ledger

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func keyOf(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}

func TestNoPasswordLedgerIsOpen(t *testing.T) {
	event := map[string]any{"id": "e"}
	for k, v := range VerifierFields(NoPassKey) {
		event[k] = v
	}
	if HasPassword(event) {
		t.Fatal("empty key should mean no password")
	}
	if !Matches(event, "") {
		t.Fatal("no-password ledger should match any request")
	}
}

func TestVerifierMatchesOnlyCorrectKey(t *testing.T) {
	key := keyOf("secret")
	event := map[string]any{}
	for k, v := range VerifierFields(key) {
		event[k] = v
	}
	if !HasPassword(event) {
		t.Fatal("should have password")
	}
	if !Matches(event, key) {
		t.Fatal("correct key rejected")
	}
	if Matches(event, keyOf("wrong")) {
		t.Fatal("wrong key accepted")
	}
	if Matches(event, "") {
		t.Fatal("missing key accepted")
	}
}

func TestVerifierIsSaltedPerLedger(t *testing.T) {
	key := keyOf("same")
	a := VerifierFields(key)
	b := VerifierFields(key)
	if a["ledgerSalt"] == b["ledgerSalt"] {
		t.Fatal("salt reused")
	}
	if a["ledgerVerifier"] == b["ledgerVerifier"] {
		t.Fatal("verifier must depend on salt")
	}
}

func TestPublicHidesSecrets(t *testing.T) {
	key := keyOf("secret")
	event := map[string]any{"id": "e", "name": "账簿"}
	for k, v := range VerifierFields(key) {
		event[k] = v
	}
	public := Public(event)
	for _, field := range []string{"ledgerVerifier", "ledgerSalt", "passwordHash"} {
		if _, ok := public[field]; ok {
			t.Fatalf("%s leaked", field)
		}
	}
	if public["hasPassword"] != true {
		t.Fatal("hasPassword missing")
	}
	if public["name"] != "账簿" {
		t.Fatal("normal field lost")
	}
}

func TestMigrateLegacyPasswordHash(t *testing.T) {
	key := keyOf("legacy")
	event := map[string]any{"id": "old", "passwordHash": key}
	changed, ok := Migrate(event)
	if !changed || !ok {
		t.Fatal("legacy hash should migrate")
	}
	if _, exists := event["passwordHash"]; exists {
		t.Fatal("legacy field kept")
	}
	if !Matches(event, key) {
		t.Fatal("migrated ledger rejects correct key")
	}
	// 再迁移一次应无改动
	again, ok := Migrate(event)
	if again || !ok {
		t.Fatal("second migrate should be a no-op")
	}
}

func TestMigrateMalformedHashKeepsLocked(t *testing.T) {
	event := map[string]any{"id": "bad", "passwordHash": "not-a-hash"}
	changed, ok := Migrate(event)
	if changed || ok {
		t.Fatal("malformed hash must not be migrated")
	}
	if !HasPassword(event) {
		t.Fatal("malformed hash should still require a password")
	}
}

func TestNormalizeKey(t *testing.T) {
	upper := keyOf("x")
	upper = string([]byte(upper))
	if k, ok := NormalizeKey(""); !ok || k != NoPassKey {
		t.Fatal("empty should map to no-password key")
	}
	if _, ok := NormalizeKey("zzz"); ok {
		t.Fatal("invalid key accepted")
	}
	if k, ok := NormalizeKey(upper); !ok || k != upper {
		t.Fatal("valid key mangled")
	}
}
