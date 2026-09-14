package planning

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestConsequenceTargetsRequireExistingPlanningItems(t *testing.T) {
	for _, test := range []struct {
		name, target string
		missing      bool
	}{
		{"omitted", "", false},
		{"existing planning item", `{"scope":"planning","itemId":"destination"}`, false},
		{"missing planning item", `{"scope":"planning","itemId":"missing"}`, true},
		{"unavailable core record", `{"scope":"core","collection":"characters","id":"missing"}`, false},
		{"external annotation", `{"scope":"external","addonId":"rules","kind":"spell","id":"missing","label":"Spell"}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			dataset := Dataset{Items: map[string]Item{"owner": {ID: "owner", Kind: "quest"}, "destination": {ID: "destination", Kind: "quest"}},
				Consequences: map[string]Consequence{"effect": {ID: "effect", Anchor: json.RawMessage(`{"scope":"item","itemId":"owner"}`), Target: json.RawMessage(test.target), Title: "Retain this", Body: "Authored prose"}},
			}
			var want []string
			if test.missing {
				want = []string{"consequence effect has a missing planning target"}
			}
			if issues := Validate(dataset); !slices.Equal(issues, want) {
				t.Fatalf("issues = %v, want %v", issues, want)
			}
			if value := dataset.Consequences["effect"]; value.Body != "Authored prose" || string(value.Target) != test.target {
				t.Fatal("validation changed authored content")
			}
		})
	}
}
