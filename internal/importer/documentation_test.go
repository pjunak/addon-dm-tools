package importer

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

func TestDocumentedPlanningExamples(t *testing.T) {
	for _, example := range []struct {
		file    string
		creates int
	}{
		{"planning-siblings.json", 4},
		{"planning-context.json", 15},
	} {
		t.Run(example.file, func(t *testing.T) {
			document := documentedImport(t, example.file)
			data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{}}
			documentedPreview(t, data, document, summary{Creates: example.creates})
		})
	}

	t.Run("cross-parent flow is rejected", func(t *testing.T) {
		document := documentedImport(t, "planning-siblings.json")
		flow, err := os.ReadFile("../../docs/examples/planning-cross-parent-flow.json")
		if err != nil {
			t.Fatal(err)
		}
		document["flowLinks"] = mustJSON(t, []json.RawMessage{flow})
		documentedRejection(t, &fakeData{}, document, "crosses canvas scopes")
	})

	t.Run("merge replay preserves omitted records and layouts", func(t *testing.T) {
		document := documentedImport(t, "planning-context.json")
		data := documentedStore(t, document)
		addDocumentedSurvivors(t, data)
		handler, preview := documentedPreview(t, data, document, summary{Skips: 15})
		if len(handler.plans[preview["token"].(string)].mutations) != 0 {
			t.Fatal("unchanged merge changed stored planning or layout")
		}
	})

	t.Run("complete-record update keeps its scope and unrelated data", func(t *testing.T) {
		baseline := documentedImport(t, "planning-siblings.json")
		data := documentedStore(t, baseline)
		addDocumentedSurvivors(t, data)
		document := documentedImport(t, "planning-update.json")
		handler, preview := documentedPreview(t, data, document, summary{Updates: 1})
		mutations := handler.plans[preview["token"].(string)].mutations
		if len(mutations) != 1 {
			t.Fatalf("update also changed unrelated records: %+v", mutations)
		}
		mutation := mutations[0]
		if mutation.Operation != "put" || mutation.Reference.DataID != "planning_items" ||
			mutation.Key != "example-find-courier" || mutation.ExpectedRevision != 7 {
			t.Fatalf("unexpected update: %+v", mutation)
		}
		var before, after map[string]json.RawMessage
		if err := json.Unmarshal(data.documents["planning_items"][1].Value, &before); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(mustJSON(t, mutation.Value), &after); err != nil {
			t.Fatal(err)
		}
		var items []map[string]json.RawMessage
		if err := json.Unmarshal(document["items"], &items); err != nil {
			t.Fatal(err)
		}
		before["summary"] = items[0]["summary"]
		before["body"] = items[0]["body"]
		before["updatedAt"] = document["generatedAt"]
		// Compare decoded values so JSON whitespace cannot hide an authored-field change.
		var expected, actual any
		if err := json.Unmarshal(mustJSON(t, before), &expected); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(mustJSON(t, after), &actual); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(expected, actual) {
			t.Fatalf("update did not preserve the other authored fields: %+v", actual)
		}
	})

	for _, scenario := range []struct {
		name      string
		unchanged bool
		stale     bool
		oldTime   bool
		omitBody  bool
		wantError string
	}{
		{name: "unchanged update with current timestamp skips", unchanged: true},
		{name: "unchanged update still requires current timestamp", unchanged: true, stale: true, wantError: "stale expectedUpdatedAt"},
		{name: "changed update needs a later generatedAt", oldTime: true, wantError: "generatedAt must be later"},
		{name: "update requires the complete record", omitBody: true, wantError: "missing body"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			baseline := documentedImport(t, "planning-siblings.json")
			data := documentedStore(t, baseline)
			document := documentedImport(t, "planning-update.json")
			var items, originals []map[string]json.RawMessage
			if err := json.Unmarshal(document["items"], &items); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(baseline["items"], &originals); err != nil {
				t.Fatal(err)
			}
			if scenario.unchanged {
				items[0]["summary"] = originals[1]["summary"]
				items[0]["body"] = originals[1]["body"]
			}
			if scenario.stale {
				items[0]["expectedUpdatedAt"] = json.RawMessage("1785023999999")
			}
			if scenario.oldTime {
				document["generatedAt"] = baseline["generatedAt"]
			}
			if scenario.omitBody {
				delete(items[0], "body")
			}
			document["items"] = mustJSON(t, items)
			if scenario.wantError != "" {
				documentedRejection(t, data, document, scenario.wantError)
			} else {
				documentedPreview(t, data, document, summary{Skips: 1})
			}
		})
	}

	t.Run("replacement deletes omitted records and all layouts", func(t *testing.T) {
		document := documentedImport(t, "planning-context.json")
		data := documentedStore(t, document)
		addDocumentedSurvivors(t, data)
		document["mode"] = json.RawMessage(`"replace"`)
		handler, preview := documentedPreview(t, data, document, summary{Skips: 15, Deletes: 2})
		mutations := handler.plans[preview["token"].(string)].mutations
		expected := map[string]bool{"planning_items:unrelated-quest": true, "planning_views:root": true}
		for _, mutation := range mutations {
			identity := mutation.Reference.DataID + ":" + mutation.Key
			if mutation.Operation != "delete" || !expected[identity] || mutation.ExpectedRevision != 7 {
				t.Fatalf("unexpected replacement mutation: %+v", mutation)
			}
			delete(expected, identity)
		}
		if len(expected) != 0 {
			t.Fatalf("replacement retained omitted data or layout: %+v", expected)
		}
	})
}

func documentedImport(t *testing.T, name string) map[string]json.RawMessage {
	t.Helper()
	body, err := os.ReadFile("../../docs/examples/" + name)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(body, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

func documentedStore(t *testing.T, document map[string]json.RawMessage) *fakeData {
	t.Helper()
	_, entries, err := decodeDocument(mustJSON(t, document))
	if err != nil {
		t.Fatal(err)
	}
	data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{}}
	for _, entry := range entries {
		record := entry.Record
		data.documents[record.Collection] = append(data.documents[record.Collection],
			workerrpc.AddonDataDocument{Key: record.ID, Revision: 7, Value: record.Body})
	}
	return data
}

func addDocumentedSurvivors(t *testing.T, data *fakeData) {
	t.Helper()
	item := validItem("unrelated-quest", nil)
	delete(item, "operation")
	item["updatedAt"] = 1785024000000
	data.documents["planning_items"] = append(data.documents["planning_items"],
		workerrpc.AddonDataDocument{Key: "unrelated-quest", Revision: 7, Value: mustJSON(t, item)})
	data.documents["planning_views"] = []workerrpc.AddonDataDocument{{
		Key: "root", Revision: 7, Value: mustJSON(t, map[string]any{
			"id": "root", "schemaVersion": 3, "scopeId": nil, "updatedAt": 1785024000000,
			"positions": map[string]any{"example-plotline": map[string]any{"x": 40, "y": 80}},
		}),
	}}
}

func documentedPreview(t *testing.T, data *fakeData, document map[string]json.RawMessage, want summary) (*Handler, map[string]any) {
	t.Helper()
	handler, preview, err := previewDocumentedImport(t, data, document)
	if err != nil {
		t.Fatal(err)
	}
	if preview["summary"].(summary) != want || preview["token"] == "" {
		t.Fatalf("unexpected documented preview: %+v; want %+v", preview, want)
	}
	return handler, preview
}

func documentedRejection(t *testing.T, data *fakeData, document map[string]json.RawMessage, reason string) {
	t.Helper()
	_, _, err := previewDocumentedImport(t, data, document)
	if err == nil {
		t.Fatal("invalid documented scenario was accepted")
	}
	failure, ok := err.(*workerrpc.RPCError)
	if !ok || !strings.Contains(string(mustJSON(t, failure)), reason) {
		t.Fatalf("scenario failed for an unrelated reason: %v", err)
	}
}

func previewDocumentedImport(t *testing.T, data *fakeData, document map[string]json.RawMessage) (*Handler, map[string]any, error) {
	t.Helper()
	handler, err := New(data)
	if err != nil {
		t.Fatal(err)
	}
	result, err := handler.HandleRPC(context.Background(), workerrpc.Request{
		Method: methodPrefix + "preview",
		Params: mustJSON(t, map[string]any{"contractVersion": "import-preview.v1", "format": "dm-tools-planning", "document": document}),
		Meta:   testMeta(),
	})
	if len(data.commits) != 0 {
		t.Fatal("documentation preview wrote data")
	}
	if err != nil {
		return handler, nil, err
	}
	return handler, result.(map[string]any), nil
}
