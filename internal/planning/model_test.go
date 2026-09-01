package planning

import "testing"

func TestValidateRejectsCrossScopeAndCycles(t *testing.T) {
	parentA := "quest-a"
	parentB := "quest-b"
	dataset := Dataset{
		Items: map[string]Item{
			"quest-a": {ID: "quest-a", SchemaVersion: 3, Kind: "quest", Title: "A"},
			"quest-b": {ID: "quest-b", SchemaVersion: 3, Kind: "quest", Title: "B"},
			"event-a": {ID: "event-a", SchemaVersion: 3, Kind: "event", ParentID: &parentA, Title: "A1", EventType: "story"},
			"event-b": {ID: "event-b", SchemaVersion: 3, Kind: "event", ParentID: &parentB, Title: "B1", EventType: "story"},
		},
		Flows:      map[string]Flow{"cross": {ID: "cross", SchemaVersion: 3, SourceID: "event-a", TargetID: "event-b", Kind: "continues"}},
		References: map[string]Reference{}, Consequences: map[string]Consequence{}, Notes: map[string]Note{}, Views: map[string]View{},
	}
	issues := Validate(dataset)
	if len(issues) != 1 || issues[0] != "flow cross crosses canvas scopes" {
		t.Fatalf("issues = %#v", issues)
	}

	dataset.Flows = map[string]Flow{
		"forward": {ID: "forward", SchemaVersion: 3, SourceID: "quest-a", TargetID: "quest-b", Kind: "continues"},
		"back":    {ID: "back", SchemaVersion: 3, SourceID: "quest-b", TargetID: "quest-a", Kind: "continues"},
	}
	issues = Validate(dataset)
	if len(issues) == 0 {
		t.Fatal("expected flow cycle")
	}
}

func TestNormalizeSetsAuthoritativeTimestamp(t *testing.T) {
	body := []byte(`{"id":"quest-a","schemaVersion":3,"kind":"quest","parentId":null,"title":"A","summary":"","body":"","objective":"","setup":"","resolution":"","tags":[],"updatedAt":1}`)
	normalized, err := Normalize("planning_items", body, 25)
	if err != nil {
		t.Fatal(err)
	}
	item := normalized.Value.(*Item)
	if item.UpdatedAt != 25 || normalized.ID != "quest-a" {
		t.Fatalf("normalized = %+v", normalized)
	}
}

func TestNormalizeRejectsSchemaDriftAndAmbiguousRecords(t *testing.T) {
	tests := []struct {
		name       string
		collection string
		body       string
	}{
		{"missing required field", "planning_items", `{"id":"quest-a","schemaVersion":3,"kind":"quest","parentId":null,"title":"A","summary":"","body":"","objective":"","setup":"","resolution":"","updatedAt":1}`},
		{"duplicate tags ignoring case", "planning_items", `{"id":"quest-a","schemaVersion":3,"kind":"quest","parentId":null,"title":"A","summary":"","body":"","objective":"","setup":"","resolution":"","tags":["Villain","villain"],"updatedAt":1}`},
		{"unsupported relation", "planning_references", `{"id":"reference-a","schemaVersion":3,"itemId":"quest-a","name":"A","relation":"invented","target":{"scope":"planning","itemId":"quest-b"},"quantity":1,"notes":"","updatedAt":1}`},
		{"duplicate note anchor", "dm_notes", `{"id":"note-a","schemaVersion":3,"title":"A","body":"","anchorIds":["quest-a","quest-a"],"updatedAt":1}`},
		{"target with hidden extra field", "planning_references", `{"id":"reference-a","schemaVersion":3,"itemId":"quest-a","name":"A","relation":"related","target":{"scope":"planning","itemId":"quest-b","extra":true},"quantity":1,"notes":"","updatedAt":1}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Normalize(test.collection, []byte(test.body), 10); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
