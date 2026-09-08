package importer

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

func TestDocumentedPlanningExamples(t *testing.T) {
	valid, err := os.ReadFile("../../docs/examples/planning-siblings.json")
	if err != nil {
		t.Fatal(err)
	}
	invalidFlow, err := os.ReadFile("../../docs/examples/planning-cross-parent-flow.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, crossParent := range []bool{false, true} {
		name := "sibling flow previews without writes"
		if crossParent {
			name = "cross-parent flow is rejected"
		}
		t.Run(name, func(t *testing.T) {
			var document map[string]json.RawMessage
			if err := json.Unmarshal(valid, &document); err != nil {
				t.Fatal(err)
			}
			if crossParent {
				document["flowLinks"] = mustJSON(t, []json.RawMessage{invalidFlow})
			}
			data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{}}
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
			if crossParent {
				if err == nil {
					t.Fatal("cross-parent example was accepted")
				}
				failure, ok := err.(*workerrpc.RPCError)
				if !ok {
					t.Fatalf("unexpected error: %v", err)
				}
				encoded := string(mustJSON(t, failure))
				if !strings.Contains(encoded, "crosses canvas scopes") {
					t.Fatalf("example failed for an unrelated reason: %s", encoded)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			preview := result.(map[string]any)
			counts := preview["summary"].(summary)
			if counts.Creates != 4 || counts.Deletes != 0 || preview["token"] == "" {
				t.Fatalf("unexpected documented preview: %+v", preview)
			}
		})
	}
}
