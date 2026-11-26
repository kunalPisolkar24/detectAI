package store

import (
	"context"
	"time"
)

type Null struct{}

var _ Store = Null{}

func (Null) Get(context.Context, string, any) (bool, error) {
	return false, nil
}

func (Null) Set(context.Context, string, any, time.Duration) error {
	return nil
}

func (Null) Delete(context.Context, ...string) error {
	return nil
}
