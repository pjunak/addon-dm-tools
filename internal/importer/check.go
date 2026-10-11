package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/pjunak/addon-dm-tools/internal/planning"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

// CheckReport is an offline preview of a planning document.
type CheckReport struct {
	Mode      string
	Creates   int
	Updates   int
	Unchanged int
	Deletes   int
	Changes   []CheckChange
	// Unverified lists core and external targets, which preview cannot check.
	Unverified []string
	Warnings   []string
}

type CheckChange struct {
	Collection string
	ID         string
	Operation  string
	Label      string
}

// Check previews document with the Import Center's own validation. Stored data
// comes from baseline, a planning export, or is empty when baseline is nil. It
// cannot see host revisions, saved layouts or whether core/external targets
// exist, so the Import Center preview remains the final check. A campaign
// bundle is checked through its DM Tools planning contribution only.
func Check(document, baseline []byte, now time.Time) (CheckReport, error) {
	store, err := exportedStore(baseline)
	if err != nil {
		return CheckReport{}, err
	}
	if !json.Valid(document) {
		return CheckReport{}, errors.New("document is not valid JSON")
	}
	var warnings []string
	if len(document) > 2<<20 {
		warnings = append(warnings, "the file is larger than the Import Center's 2 MiB limit")
	}
	document, bundleRefs, err := planningDocument(document)
	if err != nil {
		return CheckReport{}, err
	}
	handler, err := New(store)
	if err != nil {
		return CheckReport{}, err
	}
	params, err := json.Marshal(map[string]any{"contractVersion": "import-preview.v1", "format": "dm-tools-planning", "document": json.RawMessage(document)})
	if err != nil {
		return CheckReport{}, err
	}
	response, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "preview", Params: params, Meta: &workerrpc.Meta{Actor: &workerrpc.Actor{Role: "dm", ID: "offline-check"}}})
	if err != nil {
		return CheckReport{}, describeFailure(err)
	}
	preview := response.(map[string]any)
	counts := preview["summary"].(summary)
	report := CheckReport{Mode: preview["mode"].(string), Creates: counts.Creates, Updates: counts.Updates, Unchanged: counts.Skips, Deletes: counts.Deletes, Warnings: warnings}
	for _, item := range preview["changes"].([]change) {
		report.Changes = append(report.Changes, CheckChange(item))
	}
	parsed, entries, _ := decodeDocument(document)
	report.Unverified = unverifiedTargets(entries, bundleRefs)
	if parsed.GeneratedAt > now.Add(5*time.Minute).UnixMilli() {
		report.Warnings = append(report.Warnings, "generatedAt is in the future; use the current time, not an invented later one")
	}
	if report.Mode == "replace" {
		report.Warnings = append(report.Warnings, "replace also deletes every saved layout, which an export does not contain")
	}
	return report, nil
}

// planningDocument returns the planning document inside body. In a campaign
// bundle, each exact {"$ref": name} object stands for the core ID the host
// reserves for that bundle record; name is a valid planning ID, so it is
// checked in its place.
func planningDocument(body []byte) ([]byte, map[string]bool, error) {
	var root struct {
		Format       string `json:"format"`
		AddonImports []struct {
			AddonID       string          `json:"addonId"`
			ContributorID string          `json:"contributorId"`
			Document      json.RawMessage `json:"document"`
		} `json:"addonImports"`
	}
	if json.Unmarshal(body, &root) != nil || root.Format != "ttrpg-codex-campaign-bundle" {
		return body, nil, nil
	}
	for _, contribution := range root.AddonImports {
		if contribution.AddonID != "dm-tools" || contribution.ContributorID != "planning-json" {
			continue
		}
		decoder := json.NewDecoder(bytes.NewReader(contribution.Document))
		decoder.UseNumber()
		var document any
		if err := decoder.Decode(&document); err != nil {
			return nil, nil, fmt.Errorf("bundle planning document is invalid: %w", err)
		}
		refs := map[string]bool{}
		resolved, err := json.Marshal(resolveBundleRefs(document, refs))
		return resolved, refs, err
	}
	return nil, nil, errors.New(`campaign bundle has no addonImports entry with addonId "dm-tools" and contributorId "planning-json"`)
}

func resolveBundleRefs(value any, refs map[string]bool) any {
	switch item := value.(type) {
	case map[string]any:
		if name, ok := item["$ref"].(string); ok && len(item) == 1 {
			refs[name] = true
			return name
		}
		for key, child := range item {
			item[key] = resolveBundleRefs(child, refs)
		}
	case []any:
		for index, child := range item {
			item[index] = resolveBundleRefs(child, refs)
		}
	}
	return value
}

// snapshotStore serves a planning export as the stored dataset.
type snapshotStore map[string][]workerrpc.AddonDataDocument

func (store snapshotStore) Query(_ context.Context, _ *workerrpc.Meta, query workerrpc.AddonDataQuery) (workerrpc.AddonDataQueryResult, error) {
	revision := int64(1)
	return workerrpc.AddonDataQueryResult{DataRevision: &revision, Documents: store[query.Reference.DataID]}, nil
}

func (snapshotStore) TransactGuarded(context.Context, *workerrpc.Meta, []workerrpc.AddonDataMutation, []workerrpc.AddonDataSetRevision) (workerrpc.AddonDataCommit, error) {
	return workerrpc.AddonDataCommit{}, errors.New("an offline check cannot commit")
}

// exportedStore reads a planning export: every record is an update stored at
// its expectedUpdatedAt.
func exportedStore(baseline []byte) (snapshotStore, error) {
	store := snapshotStore{}
	if baseline == nil {
		return store, nil
	}
	_, entries, err := decodeDocument(baseline)
	if err != nil {
		return nil, fmt.Errorf("baseline is not a planning export: %w", err)
	}
	for _, entry := range entries {
		record := entry.Record
		if entry.Operation != "update" || entry.ExpectedUpdatedAt == nil {
			return nil, fmt.Errorf("baseline record %s %s is not an update with expectedUpdatedAt; use an unedited planning export", record.Collection, record.ID)
		}
		stored, err := planning.Normalize(record.Collection, record.Body, *entry.ExpectedUpdatedAt)
		if err != nil {
			return nil, err
		}
		store[record.Collection] = append(store[record.Collection], workerrpc.AddonDataDocument{Key: stored.ID, Revision: 1, Value: stored.Body})
	}
	return store, nil
}

func describeFailure(err error) error {
	var failure *workerrpc.RPCError
	if !errors.As(err, &failure) || failure.Data == nil {
		return err
	}
	message := failure.Data.Message
	var details map[string]any
	if json.Unmarshal(failure.Data.Details, &details) != nil {
		return errors.New(message)
	}
	lines := []string{message}
	if issue, ok := details["issue"].(string); ok {
		lines = append(lines, issue)
	}
	if issues, ok := details["issues"].([]any); ok {
		for _, issue := range issues {
			lines = append(lines, fmt.Sprint(issue))
		}
	}
	if collection, ok := details["collection"].(string); ok {
		lines = append(lines, fmt.Sprintf("record: %s %v", collection, details["id"]))
	}
	if operations, ok := details["operations"]; ok {
		lines = append(lines, fmt.Sprintf("operations: %v", operations))
	}
	return errors.New(strings.Join(lines, "\n  "))
}

func unverifiedTargets(entries []importEntry, bundleRefs map[string]bool) []string {
	seen := map[string]bool{}
	for _, entry := range entries {
		var target json.RawMessage
		switch value := entry.Record.Value.(type) {
		case *planning.Reference:
			target = value.Target
		case *planning.Consequence:
			target = value.Target
		}
		var parsed struct{ Scope, Collection, AddonID, Kind, ID, Label string }
		if len(target) == 0 || json.Unmarshal(target, &parsed) != nil {
			continue
		}
		switch parsed.Scope {
		case "core":
			if bundleRefs[parsed.ID] {
				seen[fmt.Sprintf("core %s {\"$ref\": %q}, created by this bundle", parsed.Collection, parsed.ID)] = true
			} else {
				seen[fmt.Sprintf("core %s %s", parsed.Collection, parsed.ID)] = true
			}
		case "external":
			seen[fmt.Sprintf("external %s %s %s (%s)", parsed.AddonID, parsed.Kind, parsed.ID, parsed.Label)] = true
		}
	}
	result := make([]string, 0, len(seen))
	for target := range seen {
		result = append(result, target)
	}
	sort.Strings(result)
	return result
}
