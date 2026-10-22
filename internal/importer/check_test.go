package importer

import (
	"os"
	"strings"
	"testing"
	"time"
)

var checkTime = time.UnixMilli(1785024120000)

func readExample(t *testing.T, name string) []byte {
	t.Helper()
	body, err := os.ReadFile("../../docs/examples/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestCheckPreviewsDocumentedExamples(t *testing.T) {
	report, err := Check(readExample(t, "planning-context.json"), nil, checkTime)
	if err != nil || report.Creates != 15 || len(report.Changes) != 15 || len(report.Warnings) != 0 {
		t.Fatalf("context example: %+v, %v", report, err)
	}

	export := readExample(t, "planning-export.json")
	report, err = Check(readExample(t, "planning-update.json"), export, checkTime)
	if err != nil || report.Updates != 1 || report.Unchanged != 0 || report.Changes[0].ID != "example-find-courier" {
		t.Fatalf("update against export: %+v, %v", report, err)
	}

	// An unedited export is itself an importable no-op.
	report, err = Check(export, export, checkTime)
	if err != nil || report.Unchanged != 4 || len(report.Changes) != 0 {
		t.Fatalf("export against itself: %+v, %v", report, err)
	}
}

func TestCheckReportsTheImporterReason(t *testing.T) {
	document := strings.Replace(string(readExample(t, "planning-siblings.json")),
		`"targetId": "example-recover-message"`, `"targetId": "example-plotline"`, 1)
	_, err := Check([]byte(document), nil, checkTime)
	if err == nil || !strings.Contains(err.Error(), "flow example-next-quest crosses canvas scopes") {
		t.Fatalf("cross-parent flow: %v", err)
	}

	_, err = Check(readExample(t, "planning-update.json"), nil, checkTime)
	if err == nil || !strings.Contains(err.Error(), "planning_items/example-find-courier: update has a missing or stale expectedUpdatedAt") {
		t.Fatalf("update without a baseline: %v", err)
	}

	missing := strings.Replace(string(readExample(t, "planning-siblings.json")), `"body": "",`, "", 1)
	_, err = Check([]byte(missing), nil, checkTime)
	if err == nil || !strings.Contains(err.Error(), "planning_items record is missing body") {
		t.Fatalf("missing field: %v", err)
	}
}

func TestCheckRequiresAnExportBaseline(t *testing.T) {
	_, err := Check(readExample(t, "planning-update.json"), readExample(t, "planning-siblings.json"), checkTime)
	if err == nil || !strings.Contains(err.Error(), "use an unedited planning export") {
		t.Fatalf("create-only baseline: %v", err)
	}
}

func TestCheckListsUnverifiedTargetsAndWarnings(t *testing.T) {
	document := strings.Replace(string(readExample(t, "planning-context.json")),
		`"scope": "planning",
        "itemId": "example-recover-message"
      },
      "quantity"`, `"scope": "core",
        "collection": "locations",
        "id": "old-bridge"
      },
      "quantity"`, 1)
	document = strings.Replace(document, `"generatedAt": 1785024000000`, `"generatedAt": 1785100000000`, 1)
	report, err := Check([]byte(document), nil, checkTime)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Unverified) != 1 || report.Unverified[0] != "core locations old-bridge" {
		t.Fatalf("unverified targets = %+v", report.Unverified)
	}
	if len(report.Warnings) != 1 || !strings.Contains(report.Warnings[0], "in the future") {
		t.Fatalf("warnings = %+v", report.Warnings)
	}
}

func TestCheckReadsTheBundlePlanningContribution(t *testing.T) {
	planning := strings.Replace(string(readExample(t, "planning-context.json")),
		`"scope": "planning",
        "itemId": "example-recover-message"
      },
      "quantity"`, `"scope": "core",
        "collection": "locations",
        "id": {"$ref": "old-bridge"}
      },
      "quantity"`, 1)
	bundle := `{"format": "ttrpg-codex-campaign-bundle", "schemaVersion": 1, "generatedAt": 1785024000000,
		"records": {"locations": [{"ref": "old-bridge", "operation": "create", "record": {"name": "Old bridge", "visibility": "public"}}]},
		"addonImports": [{"addonId": "dm-tools", "contributorId": "planning-json", "document": ` + planning + `}]}`
	report, err := Check([]byte(bundle), nil, checkTime)
	if err != nil || report.Creates != 15 {
		t.Fatalf("bundle planning: %+v, %v", report, err)
	}
	if len(report.Unverified) != 1 || !strings.Contains(report.Unverified[0], "created by this bundle") {
		t.Fatalf("unverified targets = %+v", report.Unverified)
	}

	_, err = Check([]byte(`{"format": "ttrpg-codex-campaign-bundle", "schemaVersion": 1, "generatedAt": 1, "records": {}}`), nil, checkTime)
	if err == nil || !strings.Contains(err.Error(), "no addonImports entry") {
		t.Fatalf("bundle without planning: %v", err)
	}
}
