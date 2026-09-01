// Command build-package compiles native workers and creates the deterministic
// release archive consumed by the host package manager.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type target struct{ goos, goarch, path string }
type manifestIdentity struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}
type checksumInventory struct {
	Algorithm string            `json:"algorithm"`
	Files     map[string]string `json:"files"`
}

var targets = []target{{"windows", "amd64", "worker/windows-amd64/dm-tools.exe"}, {"linux", "amd64", "worker/linux-amd64/dm-tools"}, {"linux", "arm64", "worker/linux-arm64/dm-tools"}}
var packageEntries = []string{"addon.json", "contracts", "LICENSE", "README.md", "web", "worker"}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	root, err := repositoryRoot()
	if err != nil {
		return err
	}
	if err := buildWorkers(root); err != nil {
		return err
	}
	identity, err := readManifest(root)
	if err != nil {
		return err
	}
	distribution := filepath.Join(root, "dist")
	packageRoot := filepath.Join(distribution, "package")
	archivePath := filepath.Join(distribution, identity.ID+"-"+identity.Version+".zip")
	if err := os.RemoveAll(packageRoot); err != nil {
		return err
	}
	if err := os.Remove(archivePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(packageRoot, 0o750); err != nil {
		return err
	}
	for _, entry := range packageEntries {
		if err := copyEntry(filepath.Join(root, entry), filepath.Join(packageRoot, entry)); err != nil {
			return err
		}
	}
	if err := writeChecksums(packageRoot); err != nil {
		return err
	}
	if err := createArchive(packageRoot, archivePath); err != nil {
		return err
	}
	relative, _ := filepath.Rel(root, archivePath)
	fmt.Println(filepath.ToSlash(relative))
	return nil
}
func repositoryRoot() (string, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return "", errors.New("locate build command")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	if _, err := os.Stat(filepath.Join(root, "addon.json")); err != nil {
		return "", err
	}
	return root, nil
}
func buildWorkers(root string) error {
	goExecutable := filepath.Join(runtime.GOROOT(), "bin", "go")
	if runtime.GOOS == "windows" {
		goExecutable += ".exe"
	}
	for _, item := range targets {
		output := filepath.Join(root, filepath.FromSlash(item.path))
		if err := os.MkdirAll(filepath.Dir(output), 0o750); err != nil {
			return err
		}
		command := exec.Command(goExecutable, "build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", output, "./cmd/worker")
		command.Dir = root
		command.Env = targetEnvironment(os.Environ(), item)
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		if err := command.Run(); err != nil {
			return fmt.Errorf("build %s: %w", item.path, err)
		}
		mode := fs.FileMode(0o644)
		if item.goos != "windows" {
			mode = 0o755
		}
		if err := os.Chmod(output, mode); err != nil {
			return err
		}
	}
	return nil
}
func targetEnvironment(environment []string, item target) []string {
	filtered := make([]string, 0, len(environment)+3)
	for _, value := range environment {
		key, _, _ := strings.Cut(value, "=")
		switch strings.ToUpper(key) {
		case "CGO_ENABLED", "GOOS", "GOARCH":
			continue
		default:
			filtered = append(filtered, value)
		}
	}
	return append(filtered, "CGO_ENABLED=0", "GOOS="+item.goos, "GOARCH="+item.goarch)
}
func readManifest(root string) (manifestIdentity, error) {
	body, err := os.ReadFile(filepath.Join(root, "addon.json"))
	if err != nil {
		return manifestIdentity{}, err
	}
	var identity manifestIdentity
	if json.Unmarshal(body, &identity) != nil || identity.ID == "" || identity.Version == "" {
		return identity, errors.New("manifest identity is invalid")
	}
	return identity, nil
}
func copyEntry(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return copyFile(source, destination, info.Mode())
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o750)
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported package entry %s", path)
		}
		details, err := entry.Info()
		if err != nil {
			return err
		}
		return copyFile(path, target, details.Mode())
	})
}
func copyFile(source, destination string, mode fs.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0o750); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode.Perm())
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		_ = output.Close()
		if !complete {
			_ = os.Remove(destination)
		}
	}()
	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	complete = true
	return nil
}
func writeChecksums(root string) error {
	files, err := packageFiles(root)
	if err != nil {
		return err
	}
	inventory := checksumInventory{"sha256", make(map[string]string, len(files))}
	for _, name := range files {
		body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil {
			return err
		}
		digest := sha256.Sum256(body)
		inventory.Files[name] = hex.EncodeToString(digest[:])
	}
	body, _ := json.MarshalIndent(inventory, "", "  ")
	body = append(body, '\n')
	return os.WriteFile(filepath.Join(root, "checksums.json"), body, 0o640)
}
func createArchive(root, destination string) error {
	files, err := packageFiles(root)
	if err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		_ = output.Close()
		if !complete {
			_ = os.Remove(destination)
		}
	}()
	archive := zip.NewWriter(output)
	fixed := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, name := range files {
		mode := fs.FileMode(0o644)
		if strings.HasPrefix(name, "worker/linux-") {
			mode = 0o755
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetModTime(fixed)
		header.SetMode(mode)
		writer, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		input, err := os.Open(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(writer, input)
		closeErr := input.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err := archive.Close(); err != nil {
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	complete = true
	return nil
}
func packageFiles(root string) ([]string, error) {
	files := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported package entry %s", path)
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(relative))
		return nil
	})
	sort.Strings(files)
	return files, err
}
