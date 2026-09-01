// Package planning owns the strict schema-v3 planning document and its
// cross-record ownership and local-flow invariants.
package planning

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
)

const SchemaVersion = 3

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,119}$`)
var forbiddenIDs = map[string]bool{"__proto__": true, "prototype": true, "constructor": true}

type Item struct {
	ID            string   `json:"id"`
	SchemaVersion int      `json:"schemaVersion"`
	Kind          string   `json:"kind"`
	ParentID      *string  `json:"parentId"`
	Title         string   `json:"title"`
	Summary       string   `json:"summary"`
	Body          string   `json:"body"`
	Objective     string   `json:"objective"`
	Setup         string   `json:"setup"`
	Resolution    string   `json:"resolution"`
	EventType     string   `json:"eventType,omitempty"`
	BranchType    string   `json:"branchType,omitempty"`
	Tags          []string `json:"tags"`
	UpdatedAt     int64    `json:"updatedAt"`
}
type Flow struct {
	ID            string `json:"id"`
	SchemaVersion int    `json:"schemaVersion"`
	SourceID      string `json:"sourceId"`
	TargetID      string `json:"targetId"`
	Kind          string `json:"kind"`
	Label         string `json:"label"`
	UpdatedAt     int64  `json:"updatedAt"`
}
type Reference struct {
	ID            string          `json:"id"`
	SchemaVersion int             `json:"schemaVersion"`
	ItemID        string          `json:"itemId"`
	Name          string          `json:"name"`
	Relation      string          `json:"relation"`
	Target        json.RawMessage `json:"target"`
	Quantity      int             `json:"quantity"`
	Notes         string          `json:"notes"`
	UpdatedAt     int64           `json:"updatedAt"`
}
type Consequence struct {
	ID            string          `json:"id"`
	SchemaVersion int             `json:"schemaVersion"`
	Anchor        json.RawMessage `json:"anchor"`
	Kind          string          `json:"kind"`
	Title         string          `json:"title"`
	Body          string          `json:"body"`
	Target        json.RawMessage `json:"target,omitempty"`
	UpdatedAt     int64           `json:"updatedAt"`
}
type Note struct {
	ID            string   `json:"id"`
	SchemaVersion int      `json:"schemaVersion"`
	Title         string   `json:"title"`
	Body          string   `json:"body"`
	AnchorIDs     []string `json:"anchorIds"`
	UpdatedAt     int64    `json:"updatedAt"`
}
type View struct {
	ID            string              `json:"id"`
	SchemaVersion int                 `json:"schemaVersion"`
	ScopeID       *string             `json:"scopeId"`
	Positions     map[string]Position `json:"positions"`
	UpdatedAt     int64               `json:"updatedAt"`
}
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Dataset struct {
	Items        map[string]Item
	Flows        map[string]Flow
	References   map[string]Reference
	Consequences map[string]Consequence
	Notes        map[string]Note
	Views        map[string]View
}

type Normalized struct {
	Collection string
	ID         string
	Label      string
	UpdatedAt  int64
	Value      any
	Body       json.RawMessage
}

func Normalize(collection string, body json.RawMessage, updatedAt int64) (Normalized, error) {
	if updatedAt < 0 {
		return Normalized{}, errors.New("generatedAt must be a non-negative epoch-millisecond integer")
	}
	var raw map[string]json.RawMessage
	if err := decodeExact(body, &raw); err != nil {
		return Normalized{}, fmt.Errorf("%s record must be one object: %w", collection, err)
	}
	required := map[string][]string{
		"planning_items":        {"id", "schemaVersion", "kind", "parentId", "title", "summary", "body", "objective", "setup", "resolution", "tags", "updatedAt"},
		"planning_flow_links":   {"id", "schemaVersion", "sourceId", "targetId", "kind", "label", "updatedAt"},
		"planning_references":   {"id", "schemaVersion", "itemId", "name", "relation", "target", "quantity", "notes", "updatedAt"},
		"planning_consequences": {"id", "schemaVersion", "anchor", "kind", "title", "body", "updatedAt"},
		"dm_notes":              {"id", "schemaVersion", "title", "body", "anchorIds", "updatedAt"},
	}[collection]
	for _, field := range required {
		if raw[field] == nil {
			return Normalized{}, fmt.Errorf("%s record is missing %s", collection, field)
		}
	}
	var value any
	switch collection {
	case "planning_items":
		value = &Item{}
	case "planning_flow_links":
		value = &Flow{}
	case "planning_references":
		value = &Reference{}
	case "planning_consequences":
		value = &Consequence{}
	case "dm_notes":
		value = &Note{}
	default:
		return Normalized{}, fmt.Errorf("unknown planning collection %q", collection)
	}
	if err := decodeExact(body, value); err != nil {
		return Normalized{}, fmt.Errorf("%s record is invalid: %w", collection, err)
	}
	var id, label string
	switch record := value.(type) {
	case *Item:
		record.UpdatedAt = updatedAt
		id, label = record.ID, record.Title
		if err := validateItem(*record); err != nil {
			return Normalized{}, err
		}
	case *Flow:
		record.UpdatedAt = updatedAt
		id, label = record.ID, record.Label
		if err := validateFlow(*record); err != nil {
			return Normalized{}, err
		}
	case *Reference:
		record.UpdatedAt = updatedAt
		id, label = record.ID, record.Name
		if err := validateReference(*record); err != nil {
			return Normalized{}, err
		}
	case *Consequence:
		record.UpdatedAt = updatedAt
		id, label = record.ID, record.Title
		if err := validateConsequence(*record); err != nil {
			return Normalized{}, err
		}
	case *Note:
		record.UpdatedAt = updatedAt
		id, label = record.ID, record.Title
		if err := validateNote(*record); err != nil {
			return Normalized{}, err
		}
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return Normalized{}, err
	}
	return Normalized{Collection: collection, ID: id, Label: label, UpdatedAt: updatedAt, Value: value, Body: normalized}, nil
}

func DecodeStored(collection string, body json.RawMessage) (Normalized, error) {
	var probe struct {
		UpdatedAt int64 `json:"updatedAt"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return Normalized{}, err
	}
	return Normalize(collection, body, probe.UpdatedAt)
}

func Validate(dataset Dataset) []string {
	issues := make([]string, 0)
	for _, item := range dataset.Items {
		if item.ParentID == nil {
			continue
		}
		parent, exists := dataset.Items[*item.ParentID]
		if !exists {
			issues = append(issues, fmt.Sprintf("item %s has missing parent %s", item.ID, *item.ParentID))
			continue
		}
		if parent.Kind != "plotline" && parent.Kind != "quest" {
			issues = append(issues, fmt.Sprintf("item %s has a leaf parent", item.ID))
		}
		seen := map[string]bool{item.ID: true}
		current := item
		for current.ParentID != nil {
			if seen[*current.ParentID] {
				issues = append(issues, fmt.Sprintf("ownership cycle reaches %s", item.ID))
				break
			}
			seen[*current.ParentID] = true
			next, ok := dataset.Items[*current.ParentID]
			if !ok {
				break
			}
			current = next
		}
	}
	adjacency := make(map[string][]string)
	for _, flow := range dataset.Flows {
		source, sourceExists := dataset.Items[flow.SourceID]
		target, targetExists := dataset.Items[flow.TargetID]
		if !sourceExists || !targetExists {
			issues = append(issues, fmt.Sprintf("flow %s has a missing endpoint", flow.ID))
			continue
		}
		if !sameParent(source.ParentID, target.ParentID) {
			issues = append(issues, fmt.Sprintf("flow %s crosses canvas scopes", flow.ID))
		}
		if flow.Kind == "option" && source.Kind != "branch" {
			issues = append(issues, fmt.Sprintf("option flow %s does not start at a branch", flow.ID))
		}
		adjacency[source.ID] = append(adjacency[source.ID], target.ID)
	}
	state := make(map[string]int)
	var visit func(string)
	visit = func(id string) {
		if state[id] == 1 {
			issues = append(issues, fmt.Sprintf("flow cycle reaches %s", id))
			return
		}
		if state[id] == 2 {
			return
		}
		state[id] = 1
		for _, target := range adjacency[id] {
			visit(target)
		}
		state[id] = 2
	}
	keys := make([]string, 0, len(adjacency))
	for id := range adjacency {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		visit(id)
	}
	for _, reference := range dataset.References {
		if _, ok := dataset.Items[reference.ItemID]; !ok {
			issues = append(issues, fmt.Sprintf("reference %s has a missing item", reference.ID))
		}
		if targetScope(reference.Target) == "planning" {
			id := targetField(reference.Target, "itemId")
			if _, ok := dataset.Items[id]; !ok {
				issues = append(issues, fmt.Sprintf("reference %s has a missing planning target", reference.ID))
			}
		}
	}
	for _, note := range dataset.Notes {
		for _, id := range note.AnchorIDs {
			if _, ok := dataset.Items[id]; !ok {
				issues = append(issues, fmt.Sprintf("note %s has missing anchor %s", note.ID, id))
			}
		}
	}
	for _, consequence := range dataset.Consequences {
		scope := targetScope(consequence.Anchor)
		if scope == "item" {
			if _, ok := dataset.Items[targetField(consequence.Anchor, "itemId")]; !ok {
				issues = append(issues, fmt.Sprintf("consequence %s has a missing item anchor", consequence.ID))
			}
		} else if scope == "flow" {
			if _, ok := dataset.Flows[targetField(consequence.Anchor, "flowId")]; !ok {
				issues = append(issues, fmt.Sprintf("consequence %s has a missing flow anchor", consequence.ID))
			}
		} else {
			issues = append(issues, fmt.Sprintf("consequence %s has an invalid anchor", consequence.ID))
		}
	}
	return unique(issues)
}

func validateItem(item Item) error {
	if err := common(item.ID, item.SchemaVersion, item.UpdatedAt); err != nil {
		return err
	}
	if !oneOf(item.Kind, "plotline", "quest", "event", "branch") || strings.TrimSpace(item.Title) == "" || len(item.Title) > 160 || len(item.Summary) > 2000 || len(item.Body) > 80000 || len(item.Objective) > 10000 || len(item.Setup) > 30000 || len(item.Resolution) > 30000 || len(item.Tags) > 40 {
		return errors.New("planning item fields are invalid")
	}
	if item.ParentID != nil && !validID(*item.ParentID) {
		return errors.New("planning item parentId is invalid")
	}
	if item.Kind == "event" && !oneOf(item.EventType, "story", "encounter", "puzzle") || item.Kind != "event" && item.EventType != "" {
		return errors.New("planning item eventType is invalid")
	}
	if item.Kind == "branch" && !oneOf(item.BranchType, "decision", "condition", "random") || item.Kind != "branch" && item.BranchType != "" {
		return errors.New("planning item branchType is invalid")
	}
	for _, tag := range item.Tags {
		if strings.TrimSpace(tag) == "" || len(tag) > 60 {
			return errors.New("planning item tag is invalid")
		}
	}
	if !uniqueStrings(item.Tags, true) {
		return errors.New("planning item tags must be unique ignoring case")
	}
	return nil
}
func validateFlow(flow Flow) error {
	if err := common(flow.ID, flow.SchemaVersion, flow.UpdatedAt); err != nil {
		return err
	}
	if !validID(flow.SourceID) || !validID(flow.TargetID) || flow.SourceID == flow.TargetID || !oneOf(flow.Kind, "continues", "option") || len(flow.Label) > 200 {
		return errors.New("planning flow fields are invalid")
	}
	return nil
}
func validateReference(value Reference) error {
	if err := common(value.ID, value.SchemaVersion, value.UpdatedAt); err != nil {
		return err
	}
	if !validID(value.ItemID) || strings.TrimSpace(value.Name) == "" || len(value.Name) > 200 ||
		!oneOf(value.Relation, "related", "involves", "features", "located-at", "opposes", "supports", "reveals", "requires", "rewards") ||
		value.Quantity < 1 || value.Quantity > 1000 || len(value.Notes) > 2000 || !validTarget(value.Target) {
		return errors.New("planning reference fields are invalid")
	}
	return nil
}
func validateConsequence(value Consequence) error {
	if err := common(value.ID, value.SchemaVersion, value.UpdatedAt); err != nil {
		return err
	}
	if !oneOf(value.Kind, "world", "reward", "information", "complication") || strings.TrimSpace(value.Title) == "" || len(value.Title) > 200 || len(value.Body) > 10000 || !validAnchor(value.Anchor) || len(value.Target) > 0 && !validTarget(value.Target) {
		return errors.New("planning consequence fields are invalid")
	}
	return nil
}
func validateNote(value Note) error {
	if err := common(value.ID, value.SchemaVersion, value.UpdatedAt); err != nil {
		return err
	}
	if strings.TrimSpace(value.Title) == "" || len(value.Title) > 200 || len(value.Body) > 30000 || len(value.AnchorIDs) > 100 {
		return errors.New("DM note fields are invalid")
	}
	for _, id := range value.AnchorIDs {
		if !validID(id) {
			return errors.New("DM note anchor is invalid")
		}
	}
	if !uniqueStrings(value.AnchorIDs, false) {
		return errors.New("DM note anchors must be unique")
	}
	return nil
}
func common(id string, version int, updatedAt int64) error {
	if !validID(id) || version != SchemaVersion || updatedAt < 0 {
		return errors.New("planning record identity is invalid")
	}
	return nil
}
func validID(value string) bool { return idPattern.MatchString(value) && !forbiddenIDs[value] }
func validAnchor(raw json.RawMessage) bool {
	switch targetScope(raw) {
	case "item":
		var value struct {
			Scope  string `json:"scope"`
			ItemID string `json:"itemId"`
		}
		return decodeExact(raw, &value) == nil && validID(value.ItemID)
	case "flow":
		var value struct {
			Scope  string `json:"scope"`
			FlowID string `json:"flowId"`
		}
		return decodeExact(raw, &value) == nil && validID(value.FlowID)
	default:
		return false
	}
}
func validTarget(raw json.RawMessage) bool {
	switch targetScope(raw) {
	case "planning":
		var value struct {
			Scope  string `json:"scope"`
			ItemID string `json:"itemId"`
		}
		return decodeExact(raw, &value) == nil && validID(value.ItemID)
	case "core":
		var value struct {
			Scope      string `json:"scope"`
			Collection string `json:"collection"`
			ID         string `json:"id"`
		}
		return decodeExact(raw, &value) == nil && oneOf(value.Collection, "characters", "factions", "locations", "mysteries", "artifacts", "events") && validID(value.ID)
	case "external":
		var value struct {
			Scope   string `json:"scope"`
			AddonID string `json:"addonId"`
			Kind    string `json:"kind"`
			ID      string `json:"id"`
			Label   string `json:"label"`
		}
		return decodeExact(raw, &value) == nil && validAddonID(value.AddonID) && len(value.Kind) > 0 && len(value.Kind) <= 80 && validID(value.ID) && len(value.Label) > 0 && len(value.Label) <= 200
	default:
		return false
	}
}
func targetScope(raw json.RawMessage) string { return targetField(raw, "scope") }
func targetField(raw json.RawMessage, field string) string {
	var value map[string]json.RawMessage
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	var result string
	_ = json.Unmarshal(value[field], &result)
	return result
}
func sameParent(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}
func validAddonID(value string) bool {
	if len(value) < 1 || len(value) > 80 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	separator := false
	for _, character := range value[1:] {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
			separator = false
			continue
		}
		if character == '-' && !separator {
			separator = true
			continue
		}
		return false
	}
	return !separator
}
func uniqueStrings(values []string, fold bool) bool {
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		key := value
		if fold {
			key = strings.ToLower(value)
		}
		if seen[key] {
			return false
		}
		seen[key] = true
	}
	return true
}
func unique(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}
func decodeExact(body []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("JSON contains more than one value")
	}
	return nil
}
