package lock

import (
	"context"
	"time"
)

type Null struct{}

var _ Locker = Null{}

func (Null) Acquire(context.Context, string, time.Duration) (string, error) {
	return "null", nil
}

func (Null) Release(context.Context, string, string) error {
	return nil
}
