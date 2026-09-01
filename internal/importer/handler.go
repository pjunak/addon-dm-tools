// Package importer implements the generation-scoped planning import adapter.
// Preview owns normalization and exact optimistic mutations; commit consumes a
// single-use token and submits only that reviewed plan.
package importer

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"sync"
	"time"

	"github.com/pjunak/addon-dm-tools/internal/planning"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

const Contract = "codex.import-adapter"
const ContractVersion = "2.0.0"
const methodPrefix = "service/" + Contract + "/"
const maximumPlans = 128
const planLifetime = 15 * time.Minute

var planningCollections = []string{"planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes"}

type DataStore interface {
	Query(context.Context, *workerrpc.Meta, workerrpc.AddonDataQuery) (workerrpc.AddonDataQueryResult, error)
	Transact(context.Context, *workerrpc.Meta, []workerrpc.AddonDataMutation) (workerrpc.AddonDataCommit, error)
}

type Handler struct {
	data  DataStore
	now   func() time.Time
	mu    sync.Mutex
	plans map[string]storedPlan
}
type storedPlan struct {
	expires   time.Time
	mutations []workerrpc.AddonDataMutation
	writes    int
	deletes   int
}
type storedDocument struct {
	normalized planning.Normalized
	revision   int64
}

type previewRequest struct {
	ContractVersion string          `json:"contractVersion"`
	Format          string          `json:"format"`
	Document        json.RawMessage `json:"document"`
}
type commitRequest struct {
	ContractVersion string `json:"contractVersion"`
	Token           string `json:"token"`
}
type importDocument struct {
	Format        string            `json:"format"`
	SchemaVersion int               `json:"schemaVersion"`
	GeneratedAt   int64             `json:"generatedAt"`
	Mode          string            `json:"mode,omitempty"`
	Items         []json.RawMessage `json:"items"`
	FlowLinks     []json.RawMessage `json:"flowLinks"`
	References    []json.RawMessage `json:"references"`
	Consequences  []json.RawMessage `json:"consequences"`
	Notes         []json.RawMessage `json:"notes"`
}
type importEntry struct {
	Operation         string
	ExpectedUpdatedAt *int64
	Record            planning.Normalized
}
type summary struct {
	Creates int `json:"creates"`
	Updates int `json:"updates"`
	Skips   int `json:"skips"`
	Deletes int `json:"deletes"`
}
type change struct {
	Collection string `json:"collection"`
	ID         string `json:"id"`
	Operation  string `json:"operation"`
	Label      string `json:"label"`
}

func New(data DataStore) (*Handler, error) {
	if data == nil {
		return nil, errors.New("add-on data client is required")
	}
	return &Handler{data: data, now: time.Now, plans: make(map[string]storedPlan)}, nil
}

func (handler *Handler) HandleRPC(ctx context.Context, request workerrpc.Request) (any, error) {
	if handler == nil || handler.data == nil {
		return nil, unavailable("planning import adapter is unavailable")
	}
	switch request.Method {
	case methodPrefix + "describe":
		if err := decodeEmpty(request.Params); err != nil {
			return nil, invalid("import adapter description request is invalid", nil)
		}
		return map[string]any{"contractVersion": "import-adapter-description.v1", "id": "planning-json", "label": "DM Tools planning", "description": "Nested story plans, local flow, references, consequences, and DM notes.", "formats": []string{"dm-tools-planning"}}, nil
	case methodPrefix + "preview":
		var input previewRequest
		if decodeExact(request.Params, &input) != nil || input.ContractVersion != "import-preview.v1" || input.Format != "dm-tools-planning" {
			return nil, invalid("planning preview request is invalid", nil)
		}
		return handler.preview(ctx, request.Meta, input.Document)
	case methodPrefix + "commit":
		var input commitRequest
		if decodeExact(request.Params, &input) != nil || input.ContractVersion != "import-commit.v1" || input.Token == "" {
			return nil, invalid("planning commit request is invalid", nil)
		}
		if request.Meta == nil || request.Meta.IdempotencyKey == "" {
			return nil, invalid("planning commit requires an idempotency key", nil)
		}
		return handler.commit(ctx, request.Meta, input.Token)
	default:
		return nil, workerrpc.NewRPCError(workerrpc.JSONRPCMethodNotFound, workerrpc.KindNotFound, "Import adapter method not found.", false, nil)
	}
}

func (handler *Handler) preview(ctx context.Context, meta *workerrpc.Meta, body json.RawMessage) (any, error) {
	document, entries, err := decodeDocument(body)
	if err != nil {
		return nil, invalid("planning import document is invalid", map[string]any{"issue": err.Error()})
	}
	stored, dataset, err := handler.load(ctx, meta)
	if err != nil {
		return nil, err
	}
	mutations := make([]workerrpc.AddonDataMutation, 0)
	changes := make([]change, 0)
	result := summary{}
	incoming := make(map[string]map[string]bool)
	for _, collection := range planningCollections {
		incoming[collection] = make(map[string]bool)
	}
	for _, entry := range entries {
		collection := entry.Record.Collection
		incoming[collection][entry.Record.ID] = true
		existing, exists := stored[collection][entry.Record.ID]
		if document.Mode == "replace" {
			if entry.Operation != "create" {
				return nil, invalid("replacement records must use create", map[string]any{"collection": collection, "id": entry.Record.ID})
			}
			if exists && equivalent(existing.normalized.Body, entry.Record.Body) {
				result.Skips++
				continue
			}
			revision := int64(0)
			operation := "create"
			if exists {
				revision = existing.revision
				operation = "update"
				result.Updates++
			} else {
				result.Creates++
			}
			mutations = append(mutations, putMutation(collection, entry.Record, revision))
			changes = append(changes, change{collection, entry.Record.ID, operation, label(entry.Record)})
			apply(dataset, entry.Record)
			continue
		}
		switch entry.Operation {
		case "create":
			if exists {
				if equivalent(existing.normalized.Body, entry.Record.Body) {
					result.Skips++
					continue
				}
				return nil, invalid("create conflicts with an existing planning record", map[string]any{"collection": collection, "id": entry.Record.ID})
			}
			result.Creates++
			mutations = append(mutations, putMutation(collection, entry.Record, 0))
			changes = append(changes, change{collection, entry.Record.ID, "create", label(entry.Record)})
			apply(dataset, entry.Record)
		case "update":
			if !exists || entry.ExpectedUpdatedAt == nil || *entry.ExpectedUpdatedAt != existing.normalized.UpdatedAt {
				return nil, invalid("update has a missing or stale expectedUpdatedAt", map[string]any{"collection": collection, "id": entry.Record.ID})
			}
			if equivalent(existing.normalized.Body, entry.Record.Body) {
				result.Skips++
				continue
			}
			if entry.Record.UpdatedAt <= existing.normalized.UpdatedAt {
				return nil, invalid("generatedAt must be later than the changed local record", map[string]any{"collection": collection, "id": entry.Record.ID})
			}
			result.Updates++
			mutations = append(mutations, putMutation(collection, entry.Record, existing.revision))
			changes = append(changes, change{collection, entry.Record.ID, "update", label(entry.Record)})
			apply(dataset, entry.Record)
		default:
			return nil, invalid("operation must be create or update", map[string]any{"collection": collection, "id": entry.Record.ID})
		}
	}
	if document.Mode == "replace" {
		for _, collection := range planningCollections {
			for id, existing := range stored[collection] {
				if incoming[collection][id] {
					continue
				}
				mutations = append(mutations, deleteMutation(collection, id, existing.revision))
				changes = append(changes, change{collection, id, "delete", label(existing.normalized)})
				result.Deletes++
				remove(dataset, collection, id)
			}
		}
		for id, existing := range stored["planning_views"] {
			mutations = append(mutations, deleteMutation("planning_views", id, existing.revision))
			changes = append(changes, change{"planning_views", id, "delete", "Saved canvas layout"})
			result.Deletes++
		}
	}
	if issues := planning.Validate(dataset); len(issues) > 0 {
		return nil, invalid("planning import violates dataset invariants", map[string]any{"issues": issues[:min(20, len(issues))]})
	}
	if len(mutations) > 256 {
		return nil, invalid("planning import exceeds the 256-operation limit", map[string]any{"operations": len(mutations)})
	}
	sort.Slice(changes, func(i, j int) bool {
		if changes[i].Collection == changes[j].Collection {
			return changes[i].ID < changes[j].ID
		}
		return changes[i].Collection < changes[j].Collection
	})
	token, err := handler.storePlan(storedPlan{mutations: mutations, writes: result.Creates + result.Updates, deletes: result.Deletes})
	if err != nil {
		return nil, unavailable("could not retain the reviewed import plan")
	}
	return map[string]any{"contractVersion": "import-preview-result.v1", "token": token, "format": document.Format, "mode": document.Mode, "summary": result, "warnings": []string{}, "changes": changes}, nil
}

func (handler *Handler) commit(ctx context.Context, meta *workerrpc.Meta, token string) (any, error) {
	handler.mu.Lock()
	handler.purgeExpiredLocked()
	plan, exists := handler.plans[token]
	if exists {
		delete(handler.plans, token)
	}
	handler.mu.Unlock()
	if !exists {
		return nil, workerrpc.NewRPCError(workerrpc.JSONRPCApplication, workerrpc.KindNotFound, "The reviewed import plan is missing or expired.", false, nil)
	}
	if len(plan.mutations) > 0 {
		if _, err := handler.data.Transact(ctx, meta, plan.mutations); err != nil {
			return nil, err
		}
	}
	return map[string]any{"contractVersion": "import-commit-result.v1", "committed": true, "writes": plan.writes, "deletes": plan.deletes}, nil
}

func decodeDocument(body json.RawMessage) (importDocument, []importEntry, error) {
	var raw map[string]json.RawMessage
	if decodeExact(body, &raw) != nil {
		return importDocument{}, nil, errors.New("document must be one exact JSON object")
	}
	allowed := map[string]bool{"format": true, "schemaVersion": true, "generatedAt": true, "mode": true, "items": true, "flowLinks": true, "references": true, "consequences": true, "notes": true}
	for key := range raw {
		if !allowed[key] {
			return importDocument{}, nil, fmt.Errorf("unknown document field %q", key)
		}
	}
	for _, required := range []string{"format", "schemaVersion", "generatedAt", "items", "flowLinks", "references", "consequences", "notes"} {
		if raw[required] == nil {
			return importDocument{}, nil, fmt.Errorf("missing document field %q", required)
		}
	}
	var document importDocument
	if decodeExact(body, &document) != nil || document.Format != "dm-tools-planning" || document.SchemaVersion != planning.SchemaVersion || document.GeneratedAt < 0 {
		return importDocument{}, nil, errors.New("document identity or generatedAt is invalid")
	}
	if document.Mode == "" {
		document.Mode = "merge"
	}
	if document.Mode != "merge" && document.Mode != "replace" {
		return importDocument{}, nil, errors.New("mode must be merge or replace")
	}
	groups := []struct {
		collection string
		records    []json.RawMessage
	}{{"planning_items", document.Items}, {"planning_flow_links", document.FlowLinks}, {"planning_references", document.References}, {"planning_consequences", document.Consequences}, {"dm_notes", document.Notes}}
	entries := make([]importEntry, 0)
	seen := make(map[string]bool)
	for _, group := range groups {
		for _, record := range group.records {
			entry, err := decodeEntry(group.collection, record, document.GeneratedAt)
			if err != nil {
				return importDocument{}, nil, err
			}
			identity := group.collection + ":" + entry.Record.ID
			if seen[identity] {
				return importDocument{}, nil, fmt.Errorf("duplicate record %s", identity)
			}
			seen[identity] = true
			entries = append(entries, entry)
		}
	}
	return document, entries, nil
}

func decodeEntry(collection string, body json.RawMessage, generatedAt int64) (importEntry, error) {
	var raw map[string]json.RawMessage
	if decodeExact(body, &raw) != nil {
		return importEntry{}, errors.New("import record must be an object")
	}
	var operation string
	if json.Unmarshal(raw["operation"], &operation) != nil {
		return importEntry{}, errors.New("import record operation is required")
	}
	var expected *int64
	if value, exists := raw["expectedUpdatedAt"]; exists {
		var parsed int64
		if json.Unmarshal(value, &parsed) != nil || parsed < 0 {
			return importEntry{}, errors.New("expectedUpdatedAt is invalid")
		}
		expected = &parsed
	}
	delete(raw, "operation")
	delete(raw, "expectedUpdatedAt")
	raw["updatedAt"] = json.RawMessage(fmt.Sprintf("%d", generatedAt))
	normalizedBody, _ := json.Marshal(raw)
	normalized, err := planning.Normalize(collection, normalizedBody, generatedAt)
	if err != nil {
		return importEntry{}, err
	}
	if operation == "create" && expected != nil {
		return importEntry{}, errors.New("create must omit expectedUpdatedAt")
	}
	if operation == "update" && expected == nil {
		return importEntry{}, errors.New("update requires expectedUpdatedAt")
	}
	return importEntry{Operation: operation, ExpectedUpdatedAt: expected, Record: normalized}, nil
}

func (handler *Handler) load(ctx context.Context, meta *workerrpc.Meta) (map[string]map[string]storedDocument, planning.Dataset, error) {
	stored := make(map[string]map[string]storedDocument)
	dataset := planning.Dataset{Items: map[string]planning.Item{}, Flows: map[string]planning.Flow{}, References: map[string]planning.Reference{}, Consequences: map[string]planning.Consequence{}, Notes: map[string]planning.Note{}, Views: map[string]planning.View{}}
	for _, collection := range append(append([]string{}, planningCollections...), "planning_views") {
		stored[collection] = make(map[string]storedDocument)
		cursor := ""
		for {
			page, err := handler.data.Query(ctx, meta, workerrpc.AddonDataQuery{Reference: workerrpc.AddonDataReference{Kind: workerrpc.AddonDataCollection, DataID: collection}, Cursor: cursor, Limit: 200})
			if err != nil {
				return nil, dataset, err
			}
			for _, document := range page.Documents {
				if collection == "planning_views" {
					var view planning.View
					if decodeExact(document.Value, &view) != nil || view.SchemaVersion != planning.SchemaVersion {
						return nil, dataset, invalid("stored planning view is invalid", map[string]any{"id": document.Key})
					}
					normalized := planning.Normalized{Collection: collection, ID: view.ID, Label: "Saved canvas layout", UpdatedAt: view.UpdatedAt, Value: &view, Body: document.Value}
					stored[collection][document.Key] = storedDocument{normalized, document.Revision}
					dataset.Views[view.ID] = view
				} else {
					normalized, err := planning.DecodeStored(collection, document.Value)
					if err != nil {
						return nil, dataset, invalid("stored planning data is invalid", map[string]any{"collection": collection, "id": document.Key})
					}
					stored[collection][document.Key] = storedDocument{normalized, document.Revision}
					apply(dataset, normalized)
				}
			}
			if page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
		}
	}
	if issues := planning.Validate(dataset); len(issues) > 0 {
		return nil, dataset, invalid("stored planning data violates dataset invariants", map[string]any{"issues": issues[:min(20, len(issues))]})
	}
	return stored, dataset, nil
}

func apply(dataset planning.Dataset, record planning.Normalized) {
	switch value := record.Value.(type) {
	case *planning.Item:
		dataset.Items[value.ID] = *value
	case *planning.Flow:
		dataset.Flows[value.ID] = *value
	case *planning.Reference:
		dataset.References[value.ID] = *value
	case *planning.Consequence:
		dataset.Consequences[value.ID] = *value
	case *planning.Note:
		dataset.Notes[value.ID] = *value
	}
}
func remove(dataset planning.Dataset, collection, id string) {
	switch collection {
	case "planning_items":
		delete(dataset.Items, id)
	case "planning_flow_links":
		delete(dataset.Flows, id)
	case "planning_references":
		delete(dataset.References, id)
	case "planning_consequences":
		delete(dataset.Consequences, id)
	case "dm_notes":
		delete(dataset.Notes, id)
	}
}
func putMutation(collection string, record planning.Normalized, revision int64) workerrpc.AddonDataMutation {
	return workerrpc.AddonDataMutation{Operation: "put", Reference: workerrpc.AddonDataReference{Kind: workerrpc.AddonDataCollection, DataID: collection}, Key: record.ID, ExpectedRevision: revision, Value: record.Value}
}
func deleteMutation(collection, id string, revision int64) workerrpc.AddonDataMutation {
	return workerrpc.AddonDataMutation{Operation: "delete", Reference: workerrpc.AddonDataReference{Kind: workerrpc.AddonDataCollection, DataID: collection}, Key: id, ExpectedRevision: revision}
}
func label(record planning.Normalized) string {
	if record.Label != "" {
		return record.Label
	}
	return record.ID
}
func equivalent(left, right json.RawMessage) bool {
	var a, b map[string]any
	if json.Unmarshal(left, &a) != nil || json.Unmarshal(right, &b) != nil {
		return false
	}
	delete(a, "updatedAt")
	delete(b, "updatedAt")
	leftBody, _ := json.Marshal(a)
	rightBody, _ := json.Marshal(b)
	return bytes.Equal(leftBody, rightBody)
}
func (handler *Handler) storePlan(plan storedPlan) (string, error) {
	tokenBytes := make([]byte, 24)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	handler.mu.Lock()
	defer handler.mu.Unlock()
	handler.purgeExpiredLocked()
	if len(handler.plans) >= maximumPlans {
		return "", errors.New("too many pending plans")
	}
	plan.expires = handler.now().Add(planLifetime)
	handler.plans[token] = plan
	return token, nil
}
func (handler *Handler) purgeExpiredLocked() {
	now := handler.now()
	for token, plan := range handler.plans {
		if !plan.expires.After(now) {
			delete(handler.plans, token)
		}
	}
}
func invalid(message string, details any) error {
	return workerrpc.NewRPCError(workerrpc.JSONRPCInvalidParams, workerrpc.KindValidationFailed, message, false, details)
}
func unavailable(message string) error {
	return workerrpc.NewRPCError(workerrpc.JSONRPCApplication, workerrpc.KindUnavailable, message, true, nil)
}
func decodeEmpty(body json.RawMessage) error {
	var value map[string]json.RawMessage
	if decodeExact(body, &value) != nil || len(value) != 0 {
		return errors.New("expected empty object")
	}
	return nil
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
