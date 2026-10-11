// Command check-plan previews a dm-tools-planning document offline with the
// Import Center's validation, optionally against a planning export.
package main

import (
	"fmt"
	"io"
	"os"
	"time"

	"github.com/pjunak/addon-dm-tools/internal/importer"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) < 1 || len(args) > 2 {
		fmt.Fprintln(stderr, "usage: go run ./cmd/check-plan plan.json [planning-export.json]")
		return 2
	}
	document, err := os.ReadFile(args[0])
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	var baseline []byte
	against := "an empty campaign"
	if len(args) == 2 {
		if baseline, err = os.ReadFile(args[1]); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		against = args[1]
	}
	report, err := importer.Check(document, baseline, time.Now())
	if err != nil {
		fmt.Fprintf(stdout, "INVALID %s (against %s)\n  %v\n", args[0], against, err)
		return 1
	}
	fmt.Fprintf(stdout, "VALID %s %s (against %s)\n", report.Mode, args[0], against)
	fmt.Fprintf(stdout, "creates %d, updates %d, unchanged %d, deletes %d\n", report.Creates, report.Updates, report.Unchanged, report.Deletes)
	for _, change := range report.Changes {
		fmt.Fprintf(stdout, "  %-6s %-21s %s  %q\n", change.Operation, change.Collection, change.ID, change.Label)
	}
	if len(report.Unverified) > 0 {
		fmt.Fprintln(stdout, "Targets preview does not check; confirm each one:")
		for _, target := range report.Unverified {
			fmt.Fprintf(stdout, "  %s\n", target)
		}
	}
	for _, warning := range report.Warnings {
		fmt.Fprintf(stdout, "Warning: %s\n", warning)
	}
	return 0
}
