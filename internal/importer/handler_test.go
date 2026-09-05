package importer

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

type fakeData struct {
	documents map[string][]workerrpc.AddonDataDocument
	commits   [][]workerrpc.AddonDataMutation
}

func (fake *fakeData) Query(_ context.Context, _ *workerrpc.Meta, query workerrpc.AddonDataQuery) (workerrpc.AddonDataQueryResult, error) {
	return workerrpc.AddonDataQueryResult{Documents: append([]workerrpc.AddonDataDocument(nil), fake.documents[query.Reference.DataID]...)}, nil
}
func (fake *fakeData) Transact(_ context.Context, _ *workerrpc.Meta, mutations []workerrpc.AddonDataMutation) (workerrpc.AddonDataCommit, error) {
	fake.commits = append(fake.commits, append([]workerrpc.AddonDataMutation(nil), mutations...))
	return workerrpc.AddonDataCommit{CommitID: 1, OccurredAt: time.Now(), Results: []workerrpc.AddonDataMutationResult{{Kind: "collection", DataID: mutations[0].Reference.DataID, Key: mutations[0].Key, AfterRevision: mutations[0].ExpectedRevision + 1}}, DataSets: []workerrpc.AddonDataSetRevision{{Kind: "collection", DataID: mutations[0].Reference.DataID, Revision: 1}}}, nil
}

func TestPreviewAndSingleUseCommit(t *testing.T) {
	data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{}}
	handler, err := New(data)
	if err != nil {
		t.Fatal(err)
	}
	params := mustJSON(t, map[string]any{"contractVersion": "import-preview.v1", "format": "dm-tools-planning", "document": map[string]any{
		"format": "dm-tools-planning", "schemaVersion": 3, "generatedAt": 100, "items": []any{validItem("quest-a", nil)},
		"flowLinks": []any{}, "references": []any{}, "consequences": []any{}, "notes": []any{},
	}})
	responseValue, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "preview", Params: params, Meta: testMeta()})
	if err != nil {
		t.Fatal(err)
	}
	response := responseValue.(map[string]any)
	token := response["token"].(string)
	summary := response["summary"].(summary)
	if summary.Creates != 1 || summary.Deletes != 0 {
		t.Fatalf("summary = %+v", summary)
	}
	commitParams := mustJSON(t, map[string]any{"contractVersion": "import-commit.v1", "token": token})
	player := testMeta()
	player.Actor = &workerrpc.Actor{Role: "player", ID: "player-session"}
	if _, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "commit", Params: commitParams, Meta: player}); err == nil {
		t.Fatal("player consumed a DM preview")
	}
	if _, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "commit", Params: commitParams, Meta: testMeta()}); err != nil {
		t.Fatal(err)
	}
	if len(data.commits) != 1 || len(data.commits[0]) != 1 || data.commits[0][0].Key != "quest-a" {
		t.Fatalf("commits = %+v", data.commits)
	}
	if _, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "commit", Params: commitParams, Meta: testMeta()}); err == nil {
		t.Fatal("expected consumed token to fail")
	}
}

func TestPreviewRejectsCrossScopeFlow(t *testing.T) {
	data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{}}
	handler, _ := New(data)
	parentA, parentB := "quest-a", "quest-b"
	document := map[string]any{
		"format": "dm-tools-planning", "schemaVersion": 3, "generatedAt": 100,
		"items":      []any{validItem(parentA, nil), validItem(parentB, nil), validEvent("event-a", parentA), validEvent("event-b", parentB)},
		"flowLinks":  []any{map[string]any{"operation": "create", "id": "cross", "schemaVersion": 3, "sourceId": "event-a", "targetId": "event-b", "kind": "continues", "label": ""}},
		"references": []any{}, "consequences": []any{}, "notes": []any{},
	}
	params := mustJSON(t, map[string]any{"contractVersion": "import-preview.v1", "format": "dm-tools-planning", "document": document})
	if _, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "preview", Params: params, Meta: testMeta()}); err == nil {
		t.Fatal("expected cross-scope flow rejection")
	}
}

func validItem(id string, parent *string) map[string]any {
	return map[string]any{"operation": "create", "id": id, "schemaVersion": 3, "kind": "quest", "parentId": parent, "title": id, "summary": "", "body": "", "objective": "", "setup": "", "resolution": "", "tags": []any{}}
}
func validEvent(id, parent string) map[string]any {
	return map[string]any{"operation": "create", "id": id, "schemaVersion": 3, "kind": "event", "parentId": parent, "title": id, "summary": "", "body": "", "objective": "", "setup": "", "resolution": "", "eventType": "story", "tags": []any{}}
}
func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return body
}
func testMeta() *workerrpc.Meta {
	return &workerrpc.Meta{RequestID: "request", CorrelationID: "correlation", Generation: "generation", Deadline: time.Now().Add(time.Minute), IdempotencyKey: "commit-key", Actor: &workerrpc.Actor{Role: "dm", ID: "dm-session"}}
}

func TestImportMethodsRequireHostIssuedDMActor(t *testing.T) {
	handler, _ := New(&fakeData{documents: map[string][]workerrpc.AddonDataDocument{}})
	for _, meta := range []*workerrpc.Meta{nil, {}, {Actor: &workerrpc.Actor{Role: "player"}}, {Actor: &workerrpc.Actor{Role: "system"}}} {
		for _, method := range []string{"describe", "preview", "commit"} {
			_, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + method, Params: json.RawMessage(`{}`), Meta: meta})
			var failure *workerrpc.RPCError
			if !errors.As(err, &failure) || failure.Data.Kind != workerrpc.KindUnauthorized {
				t.Fatalf("%s without DM = %v", method, err)
			}
		}
	}
}
