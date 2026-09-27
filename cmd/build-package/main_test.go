package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPackageMetadataDoesNotChangeIdentityOrWorkerPermissions(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"addon.json", "web/index.js", "worker/linux-amd64/dm-tools", "worker/windows-amd64/dm-tools.exe"} {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(name), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	first, second := filepath.Join(t.TempDir(), "first.zip"), filepath.Join(t.TempDir(), "second.zip")
	if err := createArchive(root, first); err != nil {
		t.Fatal(err)
	}
	files, err := packageFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if err := os.Chtimes(filepath.Join(root, filepath.FromSlash(file)), time.Unix(0, 0), time.Unix(0, 0)); err != nil {
			t.Fatal(err)
		}
	}
	if err := createArchive(root, second); err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(first)
	b, _ := os.ReadFile(second)
	if !bytes.Equal(a, b) {
		t.Fatal("checkout metadata changed the archive")
	}
	archive, err := zip.OpenReader(first)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(archive.File) != len(files) {
		t.Fatal("archive lost package files")
	}
	for _, entry := range archive.File {
		want := os.FileMode(0o644)
		if entry.Name == "worker/linux-amd64/dm-tools" {
			want = 0o755
		}
		if entry.Mode().Perm() != want {
			t.Fatalf("%s mode = %o, want %o", entry.Name, entry.Mode().Perm(), want)
		}
	}
}
