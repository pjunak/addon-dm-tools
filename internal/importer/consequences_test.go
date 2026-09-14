package importer

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

func consequenceEntry() map[string]any {
	return map[string]any{"operation": "create", "id": "effect", "schemaVersion": 3,
		"anchor": map[string]any{"scope": "item", "itemId": "owner"}, "kind": "information",
		"title": "The secret remains", "body": "Authored explanation\nKeep exactly.",
		"target": map[string]any{"scope": "planning", "itemId": "destination"}}
}

func storeEntry(t *testing.T, entry map[string]any) workerrpc.AddonDataDocument {
	t.Helper()
	value := make(map[string]any, len(entry))
	for key, field := range entry {
		if key != "operation" {
			value[key] = field
		}
	}
	value["updatedAt"] = 20
	return workerrpc.AddonDataDocument{Key: entry["id"].(string), Revision: 7, Value: mustJSON(t, value)}
}

func consequencePreview(t *testing.T, handler *Handler, mode string, items, consequences []any) (any, error) {
	t.Helper()
	return handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "preview", Meta: testMeta(), Params: mustJSON(t, map[string]any{
		"contractVersion": "import-preview.v1", "format": "dm-tools-planning", "document": map[string]any{
			"format": "dm-tools-planning", "schemaVersion": 3, "generatedAt": 100, "mode": mode,
			"items": items, "flowLinks": []any{}, "references": []any{}, "consequences": consequences, "notes": []any{},
		},
	})})
}

func requireMissingConsequenceTarget(t *testing.T, err error) {
	t.Helper()
	var failure *workerrpc.RPCError
	if !errors.As(err, &failure) || failure.Data.Kind != workerrpc.KindValidationFailed || !strings.Contains(string(mustJSON(t, failure)), "consequence effect has a missing planning target") {
		t.Fatalf("expected specific consequence target validation failure, got %v", err)
	}
}

func TestConsequencePreviewValidatesExistingAndIncomingTargets(t *testing.T) {
	for _, source := range []string{"stored", "incoming", "missing"} {
		t.Run(source, func(t *testing.T) {
			data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{"planning_items": {storeEntry(t, validItem("owner", nil))}}}
			items := []any{}
			if source == "stored" {
				data.documents["planning_items"] = append(data.documents["planning_items"], storeEntry(t, validItem("destination", nil)))
			}
			if source == "incoming" {
				items = append(items, validItem("destination", nil))
			}
			handler, _ := New(data)
			preview, err := consequencePreview(t, handler, "merge", items, []any{consequenceEntry()})
			if len(data.commits) != 0 {
				t.Fatal("preview wrote data")
			}
			if source == "missing" {
				requireMissingConsequenceTarget(t, err)
				if len(handler.plans) != 0 {
					t.Fatal("invalid target retained a commit plan")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "commit", Meta: testMeta(), Params: mustJSON(t, map[string]any{"contractVersion": "import-commit.v1", "token": preview.(map[string]any)["token"]})}); err != nil {
				t.Fatal(err)
			}
			if len(data.commits) != 1 || len(data.guards[0]) != 6 {
				t.Fatalf("commit = %+v", data)
			}
		})
	}
}

func TestReplacementMustExplicitlyClearRemovedConsequenceTarget(t *testing.T) {
	for _, clearTarget := range []bool{false, true} {
		data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{
			"planning_items":        {storeEntry(t, validItem("owner", nil)), storeEntry(t, validItem("destination", nil))},
			"planning_consequences": {storeEntry(t, consequenceEntry())},
		}}
		handler, _ := New(data)
		incoming := consequenceEntry()
		if clearTarget {
			delete(incoming, "target")
		}
		preview, err := consequencePreview(t, handler, "replace", []any{validItem("owner", nil)}, []any{incoming})
		if len(data.commits) != 0 {
			t.Fatal("preview wrote data")
		}
		if !clearTarget {
			requireMissingConsequenceTarget(t, err)
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		result := preview.(map[string]any)
		if counts := result["summary"].(summary); counts.Updates != 1 || counts.Deletes != 1 || counts.Skips != 1 {
			t.Fatalf("review summary = %+v", counts)
		}
		request := workerrpc.Request{Method: methodPrefix + "commit", Meta: testMeta(), Params: mustJSON(t, map[string]any{"contractVersion": "import-commit.v1", "token": result["token"]})}
		if _, err := handler.HandleRPC(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		if len(data.commits) != 1 || len(data.commits[0]) != 2 {
			t.Fatalf("unexpected writes: %+v", data.commits)
		}
		for _, mutation := range data.commits[0] {
			if mutation.ExpectedRevision != 7 {
				t.Fatalf("reviewed revision changed: %+v", mutation)
			}
			if mutation.Key == "destination" {
				if mutation.Operation != "delete" {
					t.Fatal("target item was not deleted")
				}
				continue
			}
			var value map[string]any
			if err := json.Unmarshal(mustJSON(t, mutation.Value), &value); err != nil {
				t.Fatal(err)
			}
			if _, exists := value["target"]; exists || value["title"] != incoming["title"] || value["body"] != incoming["body"] {
				t.Fatalf("annotation was not preserved: %+v", value)
			}
		}
	}
}

func TestConsequenceTargetDeletedAfterPreviewRejectsTheWholeCommit(t *testing.T) {
	data := &fakeData{revisions: map[string]int64{}, documents: map[string][]workerrpc.AddonDataDocument{
		"planning_items": {storeEntry(t, validItem("owner", nil)), storeEntry(t, validItem("destination", nil))},
	}}
	handler, _ := New(data)
	preview, err := consequencePreview(t, handler, "merge", []any{}, []any{consequenceEntry()})
	if err != nil {
		t.Fatal(err)
	}
	data.documents["planning_items"] = data.documents["planning_items"][:1]
	data.revisions["planning_items"]++
	request := workerrpc.Request{Method: methodPrefix + "commit", Meta: testMeta(), Params: mustJSON(t, map[string]any{"contractVersion": "import-commit.v1", "token": preview.(map[string]any)["token"]})}
	if _, err := handler.HandleRPC(context.Background(), request); err == nil {
		t.Fatal("committed a consequence after its target was removed")
	}
	if len(data.commits) != 0 {
		t.Fatal("conflict published partial data")
	}
	if _, err := handler.HandleRPC(context.Background(), request); err == nil {
		t.Fatal("reused a stale token")
	}
}

func TestStoredDanglingConsequenceTargetFailsWithoutRepairingData(t *testing.T) {
	data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{
		"planning_items": {storeEntry(t, validItem("owner", nil))}, "planning_consequences": {storeEntry(t, consequenceEntry())},
	}}
	before := string(data.documents["planning_consequences"][0].Value)
	handler, _ := New(data)
	_, err := consequencePreview(t, handler, "merge", []any{}, []any{})
	requireMissingConsequenceTarget(t, err)
	if len(data.commits) != 0 || len(handler.plans) != 0 || string(data.documents["planning_consequences"][0].Value) != before {
		t.Fatal("invalid stored annotation was modified or retained as a commit plan")
	}
}
