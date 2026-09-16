package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/pjunak/addon-dm-tools/internal/importer"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err := workerrpc.RunNativeWorker(ctx, workerrpc.NativeWorkerConfig{
		Reader: os.Stdin, Writer: os.Stdout,
		Methods: map[string]string{
			"service/codex.campaign-bundle-contributor/preview": "1.0.0",
			"service/codex.import-adapter/describe":             importer.ContractVersion,
			"service/codex.import-adapter/preview":              importer.ContractVersion,
			"service/codex.import-adapter/commit":               importer.ContractVersion,
		},
		HandlerFactory: workerrpc.NativeWorkerHandlerFactoryFunc(func(worker workerrpc.NativeWorkerContext) (workerrpc.RequestHandler, error) {
			data, err := workerrpc.NewAddonDataClient(worker.Peer)
			if err != nil {
				return nil, err
			}
			return importer.New(data)
		}),
	})
	if err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
