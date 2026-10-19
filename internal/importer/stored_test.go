package importer

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

// countingData counts queries and lets a concurrent transaction land just
// before a chosen one.
type countingData struct {
	*fakeData
	queries int
	writes  map[int]func()
}

func (data *countingData) Query(ctx context.Context, meta *workerrpc.Meta, query workerrpc.AddonDataQuery) (workerrpc.AddonDataQueryResult, error) {
	data.queries++
	if write := data.writes[data.queries]; write != nil {
		write()
	}
	return data.fakeData.Query(ctx, meta, query)
}

func planningImport(items, flows []any) map[string]any {
	return map[string]any{"format": "dm-tools-planning", "schemaVersion": 3, "generatedAt": 100, "items": items, "flowLinks": flows, "references": []any{}, "consequences": []any{}, "notes": []any{}}
}

func previewPlanning(t *testing.T, handler *Handler, document map[string]any) (map[string]any, error) {
	t.Helper()
	result, err := handler.HandleRPC(context.Background(), workerrpc.Request{Method: methodPrefix + "preview", Meta: testMeta(), Params: mustJSON(t, map[string]any{"contractVersion": "import-preview.v1", "format": "dm-tools-planning", "document": document})})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func referenceEntry(id, owner string) map[string]any {
	return map[string]any{"operation": "create", "id": id, "schemaVersion": 3, "itemId": owner, "name": id, "relation": "related",
		"target": map[string]any{"scope": "core", "collection": "characters", "id": "someone"}, "quantity": 1, "notes": ""}
}

// Collections are read one after another. A transaction that creates an item
// with its reference between the item and reference reads leaves a reference
// whose item seems missing; reading again shows the consistent data.
func TestTornReadIsReadOnceMoreBeforeReportingAProblem(t *testing.T) {
	newData := func() *countingData {
		return &countingData{fakeData: &fakeData{documents: map[string][]workerrpc.AddonDataDocument{}, revisions: map[string]int64{}}, writes: map[int]func(){}}
	}
	create := func(data *countingData, owner, reference string) func() {
		return func() {
			data.documents["planning_items"] = append(data.documents["planning_items"], storeEntry(t, validItem(owner, nil)))
			data.documents["planning_references"] = append(data.documents["planning_references"], storeEntry(t, referenceEntry(reference, owner)))
			data.revisions["planning_items"]++
			data.revisions["planning_references"]++
		}
	}

	data := newData()
	data.writes[2] = create(data, "owner", "ref") // after the items read
	handler, _ := New(data)
	preview, err := previewPlanning(t, handler, planningImport([]any{}, []any{}))
	if err != nil {
		t.Fatal(err)
	}
	if warnings := preview["warnings"].([]string); len(warnings) != 0 {
		t.Fatalf("a torn read was reported as stored problems: %#v", warnings)
	}
	// Six reads, one revision check that finds the change, six reads again.
	if data.queries != 13 {
		t.Fatalf("queries = %d", data.queries)
	}
	guards := handler.plans[preview["token"].(string)].dataRevisions
	if guards[0].DataID != "planning_items" || guards[0].Revision != 1 || guards[2].DataID != "planning_references" || guards[2].Revision != 1 {
		t.Fatalf("the plan is not guarded by the second read: %+v", guards)
	}

	// The read is repeated only once; a second torn read is reported as it is.
	data = newData()
	data.writes[2] = create(data, "owner", "ref")
	data.writes[9] = create(data, "owner-2", "ref-2") // after the second items read
	handler, _ = New(data)
	preview, err = previewPlanning(t, handler, planningImport([]any{}, []any{}))
	if err != nil {
		t.Fatal(err)
	}
	if warnings := preview["warnings"].([]string); len(warnings) != 2 || warnings[1] != "reference ref-2 has a missing item" || data.queries != 13 {
		t.Fatalf("warnings = %#v after %d queries", warnings, data.queries)
	}
}

func TestStableStoredProblemIsReportedWithoutReadingAgain(t *testing.T) {
	data := &countingData{fakeData: &fakeData{documents: map[string][]workerrpc.AddonDataDocument{
		"planning_references": {storeEntry(t, referenceEntry("ref", "missing"))},
	}}}
	handler, _ := New(data)
	preview, err := previewPlanning(t, handler, planningImport([]any{validItem("quest", nil)}, []any{}))
	if err != nil {
		t.Fatal(err)
	}
	if warnings := preview["warnings"].([]string); len(warnings) != 2 || warnings[1] != "reference ref has a missing item" {
		t.Fatalf("warnings = %#v", warnings)
	}
	// Six reads and six revision checks that find nothing changed.
	if data.queries != 12 {
		t.Fatalf("queries = %d", data.queries)
	}
}

// The collection schemas accept blank titles, tags that differ only by case
// and a flow to itself. Such stored records are reported, not refused, while
// an import still may not add them.
func TestRecordsBreakingPlannerRulesAreReportedWhenStoredAndRefusedWhenImported(t *testing.T) {
	blank := validItem("blank", nil)
	blank["title"] = "  "
	tagged := validItem("tagged", nil)
	tagged["tags"] = []any{"Villain", "villain"}
	loop := map[string]any{"operation": "create", "id": "loop", "schemaVersion": 3, "sourceId": "tagged", "targetId": "tagged", "kind": "continues", "label": ""}
	problems := []string{"flow loop is part of a cycle", "item blank has a blank title", "item tagged has blank or repeated tags"}

	data := &fakeData{documents: map[string][]workerrpc.AddonDataDocument{
		"planning_items":      {storeEntry(t, blank), storeEntry(t, tagged)},
		"planning_flow_links": {storeEntry(t, loop)},
	}}
	handler, _ := New(data)
	preview, err := previewPlanning(t, handler, planningImport([]any{validItem("quest", nil)}, []any{}))
	if err != nil {
		t.Fatal(err)
	}
	if warnings := preview["warnings"].([]string); len(warnings) != 4 || !slices.Equal(warnings[1:], problems) {
		t.Fatalf("warnings = %#v", warnings)
	}

	handler, _ = New(&fakeData{documents: map[string][]workerrpc.AddonDataDocument{}})
	_, err = previewPlanning(t, handler, planningImport([]any{blank, tagged}, []any{loop}))
	if err == nil {
		t.Fatal("an import added records that break planner rules")
	}
	for _, problem := range problems {
		if !strings.Contains(string(mustJSON(t, err)), problem) {
			t.Fatalf("refusal does not name %q: %v", problem, err)
		}
	}
}
